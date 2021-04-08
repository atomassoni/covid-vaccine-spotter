
const HumanizePlugin = require('@extra/humanize');
const { firefox } = require("playwright-extra");
const sleep = require("sleep-promise");
// const { PlaywrightBlocker } = require("@cliqz/adblocker-playwright");
// const retry = require("p-retry");
const random = require("lodash");

const logger = require("../../logger");

// fetch(`https://svu.marketouchmedia.com/SVUSched/program/program1987/Calendar/PatientCalendar`,{method:'POST', 'Content-Type': 'application/x-www-form-urlencoded', 'Referer':'https://svu.marketouchmedia.com/SVUSched/program/program1987/Patient/Schedule?zip=55104&appointmentType=5947', 'Cookie':' ASP.NET_SessionId=mlxyyfuft0tpqwkh5sb34vz2; QueueITAccepted-SDFrts345E-V3_cubsupervalucovid19=EventId%3Dcubsupervalucovid19%26QueueId%3D41d0d7c0-2370-4654-af56-339a6effd0cb%26RedirectType%3Dsafetynet%26IssueTime%3D1617465373%26Hash%3De50880eb65ab110785146629b2667042c1833f989de3a70d8f2e3d12a38f34dc; .ASPXAUTH=ADD76155070A4A79447A5A9F6E7A1B7096646F53EBB1F11B561CC486E8CC9A4A4B8DE9B685F269B57A5132784BEB41672015573E96A4FED47CAAF50787C15B0848C56E9FCC4060A549F32204A27E3525B52EA07FB49EE99AEA1F1A7680ACC38E838B75A5049651C3A5EA5C1EF0744CC7A0C0999E31EAFC1AB4C5B8D697D798E7', 'Host': 'svu.marketouchmedia.com', 'Origin': 'https://svu.marketouchmedia.com', body: JSON.stringify({facilityId:9171, year: 2021, month: 4, appointmentTypeId: 5947})}).then(res=>{console.log(res);return res}).catch(err=>console.log(err))
firefox.use(
  HumanizePlugin({
    mouse: {
      showCursor: true, // Show the cursor (meant for testing)
    },
  })
);

class CubAuth {
  static async get() {
    if (CubAuth.auth) {
      return CubAuth.auth;
    }
    return CubAuth.refresh();
  }

  static async ensureBrowserClosed() {
    if (CubAuth.moveCursorTimeout) {
      clearTimeout(CubAuth.moveCursorTimeout);
      CubAuth.moveCursorTimeout = undefined;
    }
    if (CubAuth.page) {
      await CubAuth.page.close();
      CubAuth.page = undefined;
    }
    if (CubAuth.context) {
      await CubAuth.context.close();
      CubAuth.context = undefined;
    }
    if (CubAuth.browser) {
      await CubAuth.browser.close();
      CubAuth.browser = undefined;
    }
  }

  static async newPage() {
    await CubAuth.ensureBrowserClosed();
    CubAuth.browser = await firefox.launch({
      headless: true,
    });
    CubAuth.context = await CubAuth.browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:85.0) Gecko/20100101 Firefox/85.0",
    });
    CubAuth.page = await CubAuth.context.newPage();
  }

  static async refresh() {
    let loggedIn = false;
    logger.info(`Refreshing Cub auth`);

    await CubAuth.newPage();


    CubAuth.page.on('request', (request) => {
      logger.info('>>', request.method(), request.url())
      if (request.url().includes('CheckZipCode')) {
        logger.error('no appointments for zip')
      }
      if (request.url().includes('PatientCalendar')) {
        // logger.debug('yay', request.content())
      }
      if (request.url().includes('calendar.js')) {
        loggedIn = true
      }
      if (request.url().includes('Loggedout')) {
        loggedIn = false
      }
    })

    CubAuth.page.on('response', async (response) => {
      logger.info('<<', response.status(), response.url())
      if (response.url().startsWith('https://svu.marketouchmedia.com/SVUSched/program/program1987/Patient/Schedule?zip')) {
        CubAuth.setTemp({})
      }
      if (response.url().includes('PatientCalendarDay')) {
        const appointmentListJson = await response.json()
        const appointments = this.getAppointments(appointmentListJson)
        CubAuth.setAppointments(appointments)
        CubAuth.setTemp({ ...CubAuth.tempData })
        CubAuth.setData({ ...CubAuth.tempData })
        CubAuth.matchThisStoreAndGoToNext(CubAuth.page)

      }
      if (response.url().includes('PatientCalendar')) {
        const calendar = await response.json()
        const dayData = this.getActiveDays(calendar)
        CubAuth.setTemp({ ...CubAuth.tempData, activeDays: dayData })
        CubAuth.setData({ ...CubAuth.tempData, activeDays: dayData })
        if (dayData?.days) {
          for (const day of dayData.days) {
            await sleep(random(250, 750));
            await CubAuth.page.click(`[id='${day}']`);
            await CubAuth.page.waitForSelector('#dialog-schedule-appointment');
          }
        }
      }

      if (response.url().includes('GetInfo')) {
        const store = await response.json()
        CubAuth.setTemp({ ...store, activeDays: CubAuth.tempData?.activeDays })
        CubAuth.setData({ ...store, activeDays: CubAuth.tempData?.activeDays })
      }
    })
    await sleep(random(250, 750));

    CubAuth.page = await CubAuth.login(CubAuth.page)
    await sleep(random(250, 750));
    logger.info("Making test request");
    logger.info("Navigating to rq page...");
    await CubAuth.page.goto(
      "https://svu.marketouchmedia.com/SVUSched/program/program1987/Patient/Schedule?zip=55104&appointmentType=5947",
      {
        waitUntil: "domcontentloaded",
      }
    );
    const auth = { context: CubAuth.context, page: CubAuth.page }
    logger.info("Setting auth...");
    CubAuth.set(auth);
    logger.info("Finished auth refresh => loggedIn: ", loggedIn);
    return auth
  }

  static async login(page) {
    logger.info("Navigating to initial page...");
    await page.goto(
      "https://svu.marketouchmedia.com/SVUSched/program/program1987/Patient/Advisory",
      {
        waitUntil: "domcontentloaded",
      }
    );

    logger.info("Waiting for buttons...");

    await page.waitForSelector('#zip-input', { timeout: 180000 });
    await page.waitForLoadState("networkidle");
    await sleep(random(250, 750));
    await page.click('#zip-input');
    await sleep(random(250, 750));
    await page.fill("#zip-input", '55104');
    await sleep(random(250, 750));
    await page.click('#btnGo');
    logger.info('clicked')
    return page

  }

  static async set(auth) {
    CubAuth.auth = auth;
  }

  static async setData(data) {
    if (!CubAuth.data) {
      CubAuth.data = {}
    }
    CubAuth.data[data.FacilityId] = data
  }

  static async setTemp(data) {

    CubAuth.tempData = data
  }

  static setAppointments(data) {
    if (!CubAuth.tempData) {
      CubAuth.tempData = {}
    }
    if (!CubAuth.tempData.appointments) {
      CubAuth.tempData.appointments = {}
    }
    if (data.Data) {
      CubAuth.tempData.appointments[data.Data.Date] = data
      if (CubAuth.appointment) {
        CubAuth.appointment({ ...CubAuth.tempData, date: data.Data.Date, times: data.Data.Rows })
      }
    }

  }

  static getActiveDays(calendarJson) {
    const { Year: year, Days, Month: month } = calendarJson?.Data ?? {}
    if (Days) {
      const days = Days?.map(day => day && day.Available && day.DayNumber ? day.DayNumber : 0).filter(activeDay => activeDay)
      return { days, year, month }
    }
    return null
  }

  static getAppointments(appointmentListJson) {
    const { Rows } = appointmentListJson?.Data ?? {}
    if (Rows) {
      return appointmentListJson
    }
    return null
  }

  static appointmentSubscribe(result) {
    CubAuth.appointment = result
  }

  static async matchThisStoreAndGoToNext(page) {
    const selector = '#facility option'
    const availableStores = await page.$$eval(selector, nodes =>
      nodes.map((node, i) => {
        if (!node) {
          return {}
        }
        return {facilityId: node.getAttribute('value'), order: i}
      })
    )
      const foundThisStore = availableStores?.find(store=>CubAuth.tempData.FacilityId === store.facilityId)
      console.log('click on next?', availableStores?.find(store=>store.order === foundThisStore?.order + 1))
    }
  }
module.exports = CubAuth;
