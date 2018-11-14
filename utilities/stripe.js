const ConfirmedError = require("../error.js");
const Logger = require("../logger.js");

const STRIPE_SECRET = process.env.STRIPE_SECRET;
const TRIAL_DAYS = process.env.TRIAL_DAYS;

const countryMap = {
  "at": "eur",
  "be": "eur",
  "bg": "bgn",
  "hr": "hrk",
  "cy": "eur",
  "cz": "czk",
  "dk": "dkk",
  "ee": "eur",
  "fi": "eur",
  "fr": "eur",
  "de": "eur",
  "gr": "eur",
  "hu": "huf",
  "ie": "eur",
  "it": "eur",
  "lv": "eur",
  "lt": "eur",
  "lu": "eur",
  "mt": "eur",
  "nl": "eur",
  "pl": "pln",
  "pt": "eur",
  "ro": "ron",
  "sk": "eur",
  "si": "eur",
  "es": "eur",
  "se": "sek",
  "tr": "try",
  "gb": "gbp",
  //"us": "usd" // USD is default (no hyphen-append country)
};
const currencyToPrice = {
  "eur": {
    "half": 4.99,
    "monthly": 9.99,
    "annual": 99.99
  },
  "bgn": {
    "half": 9.99,
    "monthly": 19.99,
    "annual": 194.99
  },
  "hrk": {
    "half": 39.99,
    "monthly": 77.99,
    "annual": 779.99
  },
  "czk": {
    "half": 139.00,
    "monthly": 259.00,
    "annual": 2590.00
  },
  "dkk": {
    "half": 39.00,
    "monthly": 79.00,
    "annual": 779.00
  },
  "huf": {
    "half": 1790.00,
    "monthly": 3390,
    "annual": 32990
  },
  "pln": {
    "half": 22.99,
    "monthly": 42.99,
    "annual": 439.99
  },
  "ron": {
    "half": 23.99,
    "monthly": 44.99,
    "annual": 459.99
  },
  "sek": {
    "half": 55.00,
    "monthly": 109.00,
    "annual": 1129.00
  },
  "try": {
    "half": 34.99,
    "monthly": 48.99,
    "annual": 499.99
  },
  "gbp": {
    "half": 4.49,
    "monthly": 8.99,
    "annual": 87.99
  },
  "usd": {
    "half": 4.99,
    "monthly": 9.99,
    "annual": 99.99
  }
};

const stripe = require("stripe")( STRIPE_SECRET );
stripe.setApiVersion("2017-08-15");
const moment = require("moment");

module.exports = {
  
  createCustomer: (id, source) => {
    var options = {
      metadata: {
        "user_id": id
      }
    };
    if (source) {
      options["source"] = source;
    }
    return stripe.customers.create(options);
  },
  
  getCharges: (stripeid) => {
    return stripe.charges.list({
      customer: stripeid,
      limit: 100
    })
    .then( result => {
      var charges = [];
      for (let charge of result.data) {
        var currency = charge.currency;
        var formatter = new Intl.NumberFormat("en-us", {
          style: 'currency',
          currency: currency.toUpperCase(),
          minimumFractionDigits: 2
        });
        charges.push({
          id: charge.id,
          amount: formatter.format(charge.amount/100),
          status: charge.status,
          date: moment(charge.created*1000).format("MMMM Do, YYYY hh:mm a"),
          chargeDescription: charge.description,
          statementDescriptor: charge.statement_descriptor
        });
      }
      return charges;
    });
  },
  
  getCustomer: (stripeid) => {
    return stripe.customers.retrieve(stripeid);
  },
  
  deleteCustomer: (stripeid) => {
    return stripe.customers.del(stripeid);
  },
  
  addReferralDiscounts: (stripeid, plan, currency, referrals) => {
    // Add discount invoice item for this user's referrals
    var amountToDiscount = 0;
    if (plan.includes("annual")) {
      amountToDiscount = referrals.active.length * currencyToPrice[currency]["annual"] * 0.1;
    }
    else {
      amountToDiscount = referrals.active.length * currencyToPrice[currency]["monthly"] * 0.1;
    }
    return stripe.invoiceItems.create({
      customer: stripeid,
      amount: -1 * Math.ceil(amountToDiscount * 100), // amount takes cents (multiply by 100), round up the discount
      currency: currency,
      description: "You referred " + referrals.active.length + " users (10% discount for each referral)."
    });
  },
  
  createSubscription: (stripeid, id, plan, trial, browserLocale, paramLocale, referredBy, referrals, threedssource) => {
    var p = Promise.resolve();
    
    var currency = "usd"; // usd default
    // If it's 3ds, create the charge for the full month/year, then add the subscription with the first period as a "free trial"
    if (threedssource) {
      p = p.then(result => {
        return stripe.sources.retrieve(threedssource)
          .then(source => {
            // Get the right amount to charge based on plan and currency
            currency = (source.currency.toLowerCase() in Object.keys(currencyToPrice)) ? source.currency.toLowerCase() : "usd";
            var currencyToUse = currencyToPrice[currency];
            var toCharge = currencyToUse["monthly"];
            if (plan == "all-annual") {
              toCharge = currencyToUse["annual"];
            }
            // Add referral discounts
            toCharge = Math.floor((toCharge * (100 - referrals.percentOff)/100) * 100);
            // Make the charge
            return stripe.charges.create({
              description: "ConfirmedVPN " + plan,
              statement_descriptor: "ConfirmedVPN",
              amount: toCharge,
              currency: currency,
              customer: stripeid,
              source: source.id
            });
          });
      });
    }
    // if not 3ds, set currency from default_source
    else {
      p = p.then(result => {
        return stripe.customers.retrieve(stripeid, {
          expand: ["default_source"]
        });
      })
      .then(customer => {
        currency = module.exports.getCurrencyForCountry(customer.default_source.card.country);
      })
    }

    var discountInvoiceItem = null;
    // for both 3ds and non-3ds, create the plan. for 3ds, add a month or year to the trial for the plan.
    var options = {
      customer: stripeid,
      metadata: {
        "user_id": id,
        "browser_locale": browserLocale.toLowerCase(),
        "param_locale": paramLocale.toLowerCase()
      },
      items: [{
        plan: plan
      }]
    };
    p = p.then(result => {    
      // Apply referral coupon if user is referredBy someone
      if (referredBy) {
        options.coupon = "referral-signup";
      }
      if (trial == true) {
        options["trial_period_days"] = TRIAL_DAYS;
      }
      if (threedssource) {
        if (plan.startsWith("all-annual")) {
          options["trial_period_days"] = 365;
        }
        else if (plan.startsWith("all-monthly")) {
          options["trial_period_days"] = 32;
        }
      }
      // Check user country on credit card to charge to the right currency plan
      if (currency != "usd") {
        plan = plan + "-" + currency;
      }
      options.items = [{
        plan: plan
      }];
      
      // add referral invoice item discounts
      return module.exports.addReferralDiscounts(stripeid, plan, currency, referrals);
    })
    .then(invoiceItem => {
      discountInvoiceItem = invoiceItem;
      return stripe.subscriptions.create(options);
    })
    .catch( error => {
      if (discountInvoiceItem) {
        // on error, delete the discount invoice item we created so the user doesn't get double discount on the next successful subscription
        stripe.invoiceItems.del(discountInvoiceItem.id, function(error, confirmation) {
          if (error) {
            Logger.error("Error deleting discount invoice item: " + id + error);
          }
        });
      }
      throw error;
    });
    
    return p;
  },
  
  getSubscription: (subscriptionid) => {
    return stripe.subscriptions.retrieve(subscriptionid);
  },
  
  deleteSubscription: (subscriptionid) => {
    return stripe.subscriptions.del(subscriptionid);
  },
  
  getPaymentMethods: (stripeid) => {
    return stripe.customers.retrieve(stripeid)
      .then(customer => {
        var methods = [];
        for (let method of customer.sources.data) {
          var m = method;
          if (m.card) {
            var id = m.id;
            m = m.card;
            m.id = id;
          }
          else if (m.three_d_secure) {
            var id = m.id;
            m = m.three_d_secure;
            m.id = id;
          }
          if (method.id == customer.default_source) {
            m.is_default = true;
          }
          methods.push(m);
        }
        return methods;
      });
  },
  
  getCurrencyForCountry: (country) => {
    if (country == null || country == undefined || !country) {
      return "usd";
    }
    var country = country.toLowerCase();
    var currency;
    if (country in countryMap) {
      currency = countryMap[country];
    }
    else {
      currency = "usd";
    }
    return currency;
  },
  
  hasSource: (stripeId, sourceId) => {
    return module.exports.getPaymentMethods(stripeId)
    .then(result => {
      for (let method of result) {
        if (method.id == sourceId) {
          return true;
        }
      }
      return false;
    })
  },

  createSource: (id, source) => {
    return stripe.customers.createSource( id, {
      source: source
    })
  },
  
  deleteSource: (id, sourceId) => {
    return stripe.customers.deleteCard(id, sourceId);
  },
  
  setDefaultSource: (id, sourceId) => {
    return stripe.customers.update( id, {
      default_source: sourceId
    });
  },
  
  getInvoices: (stripeid) => {
    return stripe.invoices.list({
      customer: stripeid
    })
    .then(result => {
      var invoices = [];
      for (let invoice of result.data) {
        invoices.push({
          id: invoice.id,
          number: invoice.number,
          description: invoice.lines.data[0].description,
          start_date: moment((invoice.lines.data[0].period.start)*1000).format("MMMM Do, YYYY"),
          end_date: moment((invoice.lines.data[0].period.end)*1000).format("MMMM Do, YYYY"),
          pdf: invoice.invoice_pdf
        });
      }
      return invoices;
    });
  },
  
  stripe: stripe,
  
  currencyToPrice: currencyToPrice,
  
  countryMap: countryMap
  
};