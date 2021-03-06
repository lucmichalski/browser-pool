const puppeteer = require('puppeteer');
const BrowserPool = require('../src/browser-pool');
const PuppeteerPlugin = require('../src/browser-plugins/puppeteer-plugin');
const {
    BROWSER_POOL_EVENTS: {
        BROWSER_LAUNCHED,
        BROWSER_CLOSED,
        BROWSER_RETIRED,
        PAGE_CREATED,
        PAGE_CLOSED,
    },
} = require('../src/events');

// Tests could be generated from this blueprint for each plugin
describe('BrowserPool', () => {
    const puppeteerPlugin = new PuppeteerPlugin(puppeteer);
    let browserPool;

    beforeEach(async () => {
        browserPool = new BrowserPool({
            browserPlugins: [puppeteerPlugin],
            browserKillerIntervalSecs: 1,
        });
    });

    afterEach(async () => {
        browserPool = await browserPool.destroy();
    });

    describe('Inicialization & retirement', () => {
        test('should retire pool', async () => {
            const page = await browserPool.newPage();
            const browserController = await browserPool.getBrowserControllerByPage(page);
            jest.spyOn(browserController, 'close');

            await page.close();
            await browserPool.retire();

            expect(browserController.close).toHaveBeenCalled();
            expect(Object.values(browserPool.activeBrowserControllers)).toHaveLength(0);
            expect(Object.values(browserPool.retiredBrowserControllers)).toHaveLength(0);
        });

        test('should destroy pool', async () => {
            const page = await browserPool.newPage();
            const browserController = await browserPool.getBrowserControllerByPage(page);
            jest.spyOn(browserController, 'kill');

            await page.close();
            await browserPool.destroy();

            expect(browserController.kill).toHaveBeenCalled();
            expect(Object.values(browserPool.activeBrowserControllers)).toHaveLength(0);
            expect(Object.values(browserPool.retiredBrowserControllers)).toHaveLength(0);
        });
    });

    describe('Basic user functionality', () => {
        // Basic user facing functionality
        test('should open new page', async () => {
            const page = await browserPool.newPage();

            expect(page.goto).toBeDefined();
            expect(page.close).toBeDefined();
        });

        test('should open new page in new browser', async () => {
            jest.spyOn(puppeteerPlugin, 'launch');

            await browserPool.newPage();
            await browserPool.newPage();
            await browserPool.newPageInNewBrowser();

            expect(Object.values(browserPool.activeBrowserControllers)).toHaveLength(2);
            expect(puppeteerPlugin.launch).toHaveBeenCalledTimes(2);
        });

        test('should correctly override page close', async () => {
            jest.spyOn(browserPool, '_overridePageClose');

            const page = await browserPool.newPage();

            expect(browserPool._overridePageClose).toBeCalled(); // eslint-disable-line

            const controller = browserPool.getBrowserControllerByPage(page);

            expect(controller.activePages).toEqual(1);
            expect(controller.totalPages).toEqual(1);

            await page.close();

            expect(controller.activePages).toEqual(0);
            expect(controller.totalPages).toEqual(1);
        });

        test('should retire browser after request count', async () => {
            browserPool.retireBrowserAfterPageCount = 3;

            jest.spyOn(browserPool, '_retireBrowser');
            expect(Object.entries(browserPool.activeBrowserControllers)).toHaveLength(0);

            await browserPool.newPage();
            await browserPool.newPage();
            await browserPool.newPage();

            expect(Object.entries(browserPool.activeBrowserControllers)).toHaveLength(0);
            expect(Object.entries(browserPool.retiredBrowserControllers)).toHaveLength(1);

        expect(browserPool._retireBrowser).toBeCalledTimes(1); // eslint-disable-line
        });

        test('should allow max pages per browser', async () => {
            browserPool.maxOpenPagesPerBrowser = 1;
            jest.spyOn(browserPool, '_launchBrowser');

            await browserPool.newPage();
            expect(Object.entries(browserPool.activeBrowserControllers)).toHaveLength(1);
            await browserPool.newPage();
            expect(Object.entries(browserPool.activeBrowserControllers)).toHaveLength(2);
            await browserPool.newPage();
            expect(Object.entries(browserPool.activeBrowserControllers)).toHaveLength(3);

        expect(browserPool._launchBrowser).toBeCalledTimes(3); // eslint-disable-line
        });

        test('should killed retired browsers', async () => {
            browserPool.retireBrowserAfterPageCount = 1;
            clearInterval(browserPool.browserKillerInterval);
            browserPool.browserKillerInterval = setInterval(
                () => browserPool._killRetiredBrowsers(), // eslint-disable-line
                100,
            );
            jest.spyOn(browserPool, '_killRetiredBrowsers');
            jest.spyOn(browserPool, '_killBrowser');
            expect(Object.entries(browserPool.retiredBrowserControllers)).toHaveLength(0);

            const page = await browserPool.newPage();
            expect(Object.entries(browserPool.retiredBrowserControllers)).toHaveLength(1);
            await page.close();

            await new Promise((resolve) => setTimeout(() => {
                resolve();
            }, 1000));

        expect(browserPool._killRetiredBrowsers).toHaveBeenCalled(); //eslint-disable-line
        expect(browserPool._killBrowser).toHaveBeenCalled(); //eslint-disable-line
            expect(Object.entries(browserPool.retiredBrowserControllers)).toHaveLength(0);
        });

        describe('hooks', () => {
            test('should run hooks in series with custom args', async () => {
                const indexArray = [];
                const createAsyncHookReturningIndex = (i) => async () => {
                    const index = await new Promise((resolve) => setTimeout(() => resolve(i), 100));
                    indexArray.push(index);
                };
                const hooks = new Array(10);
                for (let i = 0; i < hooks.length; i++) {
                    hooks[i] = createAsyncHookReturningIndex(i);
                }
            await browserPool._executeHooks(hooks); // eslint-disable-line
                expect(indexArray).toHaveLength(10);
                indexArray.forEach((v, index) => expect(v).toEqual(index));
            });

            describe('preLaunchHooks', () => {
                test('should evaluate hook before launching browser with correct args', async () => {
                    const myAsyncHook = () => Promise.resolve({});
                    browserPool.preLaunchHooks = [myAsyncHook];
                    jest.spyOn(browserPool, '_executeHooks');

                    const page = await browserPool.newPage();
                    const { browserPlugin } = browserPool.getBrowserControllerByPage(page);
                expect(browserPool._executeHooks).toHaveBeenNthCalledWith(1, browserPool.preLaunchHooks, browserPlugin, expect.anything()); // eslint-disable-line
                });
            });

            describe('postLaunchHooks', () => {
                test('should evaluate hook after launching browser with correct args', async () => {
                    const myAsyncHook = () => Promise.resolve({});
                    browserPool.postLaunchHooks = [myAsyncHook];
                    jest.spyOn(browserPool, '_executeHooks');

                    const page = await browserPool.newPage();
                    const browserController = browserPool.getBrowserControllerByPage(page);
                expect(browserPool._executeHooks).toHaveBeenNthCalledWith(2, browserPool.postLaunchHooks, browserController); // eslint-disable-line
                });
            });

            describe('prePageCreateHooks', () => {
                test('should evaluate hook after launching browser with correct args', async () => {
                    const myAsyncHook = () => Promise.resolve({});
                    browserPool.prePageCreateHooks = [myAsyncHook];
                    jest.spyOn(browserPool, '_executeHooks');

                    const page = await browserPool.newPage();
                    const browserController = browserPool.getBrowserControllerByPage(page);
                expect(browserPool._executeHooks).toHaveBeenNthCalledWith(3, browserPool.prePageCreateHooks, browserController ); // eslint-disable-line
                });
            });

            describe('postPageCreateHooks', () => {
                test('should evaluate hook after launching browser with correct args', async () => {
                    const myAsyncHook = () => Promise.resolve({});
                    browserPool.postPageCreateHooks = [myAsyncHook];
                    jest.spyOn(browserPool, '_executeHooks');

                    const page = await browserPool.newPage();
                    const browserController = browserPool.getBrowserControllerByPage(page);
                    expect(browserPool._executeHooks).toHaveBeenNthCalledWith(4, browserPool.postPageCreateHooks, browserController, page ); // eslint-disable-line
                });
            });

            describe('prePageCloseHooks', () => {
                test('should evaluate hook after launching browser with correct args', async () => {
                    const myAsyncHook = () => Promise.resolve({});
                    browserPool.prePageCloseHooks = [myAsyncHook];
                    jest.spyOn(browserPool, '_executeHooks');

                    const page = await browserPool.newPage();
                    await page.close();

                    const browserController = browserPool.getBrowserControllerByPage(page);
                    expect(browserPool._executeHooks).toHaveBeenNthCalledWith(5, browserPool.prePageCloseHooks, browserController, page ); // eslint-disable-line
                });
            });

            describe('postPageCloseHooks', () => {
                test('should evaluate hook after launching browser with correct args', async () => {
                    const myAsyncHook = () => Promise.resolve({});
                    browserPool.postPageCloseHooks = [myAsyncHook];
                    jest.spyOn(browserPool, '_executeHooks');

                    const page = await browserPool.newPage();
                    await page.close();

                    const browserController = browserPool.getBrowserControllerByPage(page);
                    expect(browserPool._executeHooks).toHaveBeenNthCalledWith(6, browserPool.postPageCloseHooks, browserController, page ); // eslint-disable-line
                });
            });
        });

        describe('events', () => {
            test(`should emit ${BROWSER_LAUNCHED} event`, async () => {
                browserPool.maxOpenPagesPerBrowser = 1;
                let calls = 0;
                let argument;

                browserPool.on(BROWSER_LAUNCHED, (arg) => {
                    argument = arg;
                    calls++;
                });
                await browserPool.newPage();
                const page = await browserPool.newPage();

                expect(calls).toEqual(2);
                expect(argument).toEqual(browserPool.getBrowserControllerByPage(page));
            });

            test(`should emit ${BROWSER_RETIRED} event`, async () => {
                browserPool.retireBrowserAfterPageCount = 1;
                let calls = 0;
                let argument;
                browserPool.on(BROWSER_RETIRED, (arg) => {
                    argument = arg;
                    calls++;
                });

                await browserPool.newPage();
                const page = await browserPool.newPage();

                expect(calls).toEqual(2);
                expect(argument).toEqual(browserPool.getBrowserControllerByPage(page));
            });

            test(`should emit ${BROWSER_CLOSED} event`, async () => {
                browserPool.retireBrowserAfterPageCount = 1;
                clearInterval(browserPool.browserKillerInterval);
                browserPool.browserKillerInterval = setInterval(
                    () => browserPool._killRetiredBrowsers(), // eslint-disable-line
                    50,
                );
                let calls = 0;
                browserPool.on(BROWSER_CLOSED, () => {
                    calls++;
                });

                const page1 = await browserPool.newPage();
                const page2 = await browserPool.newPage();
                await page1.close();
                await page2.close();
                await new Promise((resolve) => setTimeout(() => resolve(), 200));
                expect(calls).toEqual(2);
            });

            test(`should emit ${PAGE_CREATED} event`, async () => {
                let calls = 0;
                let argument;
                browserPool.on(PAGE_CREATED, (arg) => {
                    argument = arg;
                    calls++;
                });

                const page = await browserPool.newPage();
                expect(argument).toEqual(page);
                const page2 = await browserPool.newPage();
                expect(calls).toEqual(2);
                expect(argument).toEqual(page2);
            });

            test(`should emit ${PAGE_CLOSED} event`, async () => {
                let calls = 0;
                let argument;
                browserPool.on(PAGE_CLOSED, (arg) => {
                    argument = arg;
                    calls++;
                });

                const page = await browserPool.newPage();
                await page.close();
                expect(argument).toEqual(page);
                const page2 = await browserPool.newPage();
                await page2.close();
                expect(calls).toEqual(2);
                expect(argument).toEqual(page2);
            });
        });
    });
});
