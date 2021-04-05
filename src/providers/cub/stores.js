// const got = require("got");

const HumanizePlugin = require('@extra/humanize');
const { firefox } = require("playwright-extra");
const { PlaywrightBlocker } = require("@cliqz/adblocker-playwright");
// const retry = require("p-retry");
const fetch = require('cross-fetch')

const { Store } = require("../../models/Store");
const { Provider } = require("../../models/Provider");
const { ProviderBrand } = require("../../models/ProviderBrand");

const logger = require("../../logger");

// fetch(`https://svu.marketouchmedia.com/SVUSched/program/program1987/Calendar/PatientCalendar`,{method:'POST', 'Content-Type': 'application/x-www-form-urlencoded', 'Referer':'https://svu.marketouchmedia.com/SVUSched/program/program1987/Patient/Schedule?zip=55104&appointmentType=5947', 'Cookie':' ASP.NET_SessionId=mlxyyfuft0tpqwkh5sb34vz2; QueueITAccepted-SDFrts345E-V3_cubsupervalucovid19=EventId%3Dcubsupervalucovid19%26QueueId%3D41d0d7c0-2370-4654-af56-339a6effd0cb%26RedirectType%3Dsafetynet%26IssueTime%3D1617465373%26Hash%3De50880eb65ab110785146629b2667042c1833f989de3a70d8f2e3d12a38f34dc; .ASPXAUTH=ADD76155070A4A79447A5A9F6E7A1B7096646F53EBB1F11B561CC486E8CC9A4A4B8DE9B685F269B57A5132784BEB41672015573E96A4FED47CAAF50787C15B0848C56E9FCC4060A549F32204A27E3525B52EA07FB49EE99AEA1F1A7680ACC38E838B75A5049651C3A5EA5C1EF0744CC7A0C0999E31EAFC1AB4C5B8D697D798E7', 'Host': 'svu.marketouchmedia.com', 'Origin': 'https://svu.marketouchmedia.com', body: JSON.stringify({facilityId:9171, year: 2021, month: 4, appointmentTypeId: 5947})}).then(res=>{console.log(res);return res}).catch(err=>console.log(err))
firefox.use(
  HumanizePlugin({
    mouse: {
      showCursor: true, // Show the cursor (meant for testing)
    },
  })
);

class CubStores {
  static async getStores() {
    CubStores.importedStores = {};
    const knex = Store.knex();
    const grid = await knex
      .select(
        knex.raw(
          "id, centroid_postal_code, st_y(centroid_location::geometry) AS latitude, st_x(centroid_location::geometry) AS longitude"
        )
      )
      .from("country_grid_220km")
      .orderBy("centroid_postal_code");
    const count = grid.length;
    for (const [index, gridCell] of grid.entries()) {
      logger.info(
        `Importing stores for ${gridCell.centroid_postal_code} (${gridCell.latitude
        },${gridCell.longitude}) (${index + 1} of ${count})...`
      );

      const resp = await CubStores.findStores(gridCell);

      if (resp.body.data.length >= 200) {
        logger.error(
          `There may be more stores within the 100 mile radius than returned, since the maximum of 200 stores was returned: ${gridCell.centroid_postal_code}. Check manually or implement smaller grid search.`
        );
      }
    }

    await Store.knex().destroy();
  }


  static async findStores() {
    CubStores.importedStores = {}

    const browser = await firefox.launch({
      headless: true
    });

    const page = await browser.newPage();
    const blocker = await PlaywrightBlocker.fromPrebuiltAdsAndTracking(
      fetch
    );
    await blocker.enableBlockingInPage(page);

    blocker.on("request-blocked", (request) => {
      logger.debug("blocked", request.url);
    });
    await page.goto('https://www.cub.com/stores/store-search-results.html?displayCount=110&state=MN',
      {
        waitUntil: 'networkidle',
      });

    const selector = '#store-search-results li'
    const json = await page.$$eval(selector, nodes =>
      nodes.map(node => {
        if (!node) {
          return {}
        }
        const locationId = node.getAttribute('data-storeid');
        const lat = node.getAttribute('data-storelat');
        const lng = node.getAttribute('data-storelng');
        const address = node?.querySelector('.store-address')?.innerText;
        const cityStateZip = node?.querySelector('.store-city-state-zip')?.innerText;
        const name = node?.querySelector('.store-display-name')?.innerText;
        const isPharmacy = node?.querySelector('.store-pharm-phone')?.innerText?.length > 10;

        // const name = node.childNodes()
        const [city, statezip] = cityStateZip?.split(',') || [null, null]
        const [, , zip] = statezip?.split(" ") || [null, null, null]
        return {
          name,
          brand: "cub",
          brand_id: locationId,
          address,
          city,
          state: 'MN',
          postal_code: zip,
          location: `point(${lng} ${lat})`,
          time_zone: 'central',
          isPharmacy
        }
      }).filter(s => s && s.brand_id && s.isPharmacy))
    logger.info('cub json', json)
    await browser.close();

    for (const store of json) {
      delete store.isPharmacy;
      if (CubStores.importedStores[store.brand_id]) {
        logger.info(`  Skipping already imported store ${store.brand_id}`);
      } else {
        logger.info(`  Importing store ${store.brand_id}`);
        await Store.query()
          .insert(store)
          .onConflict(["brand", "brand_id"])
          .merge();
        CubStores.importedStores[store.brand_id] = true;
      }
    }

    return json;
  }
}
module.exports = CubStores;
