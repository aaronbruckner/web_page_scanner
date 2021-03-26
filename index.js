import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import {program} from 'commander';
import simpleNodeLogger from 'simple-node-logger';
import {SNSClient, PublishCommand} from "@aws-sdk/client-sns";
import fs from 'fs';

const log = simpleNodeLogger.createSimpleLogger();
puppeteer.use(StealthPlugin())

/**
 * Example:
 *   node index.js --urls https://www.google.com --validCssSelector "span.stock-result" --awsSnsArn arn:aws:sns:us-west-2:11111111:Alert --subject "IN STOCK ALERT" --lockFile /home/ubuntu/lock.txt 
 */
async function main() {
    log.info('Web Page Scanner');

    program
        .requiredOption('-u, --urls [urls...]', 'Specifies the webpages to scan. Each URL provided will be processed')
        .requiredOption('-a, --awsSnsArn [arn]', 'If matches are found, the provided AWS SNS Arn will be notified.')
        .requiredOption('-s, --subject [subject]', 'If a notification is sent, this will be used as the subject line.')
        .requiredOption('-c, --validCssSelector [cssSelector]', "Allows you to specify a CSS selector. If at least one element is found on the page, the page will be considered valid.")
        .option('-l, --lockFile [path]', 'Path to a local file. If present, script will not run. Script will touch this file once a notification has been sent, preventing you from getting spammed.')
        .option('-d, --debug', 'If provided, debug logs will be printed.')
        

    program.parse();
    const opts = program.opts();

    if (opts.debug) {
        log.setLevel('debug');
        log.debug('---DEBUG LOGGING ENABLED---');
    }

    if (opts.lockFile && fs.existsSync(opts.lockFile)) {
        log.info('Exiting, lock file present');
        return;
    }

    log.debug(`Args: ${JSON.stringify(program.opts(), null, 2)}`);

    const browser = await puppeteer.launch({ headless: true });
    const validUrls = [];
    for (const url of opts.urls) {
        if (await scanPage(url, browser, opts)) {
            log.info(`Valid Page: ${url}`);
            validUrls.push(url);
            break;
        }
    }

    if (validUrls.length > 0) {
        await notify(validUrls, opts);
    }

    await browser.close();
}

async function scanPage(url, browser, opts) {
    const page = await browser.newPage();
    log.info(`Loading Page: ${url}`);
    await page.goto(url, {waitUntil: 'networkidle0'});

    const validElements = await page.$$(opts.validCssSelector)
    log.info(`Page Loaded, Valid Elements Found: ${validElements.length}`);

    await page.close();

    return validElements.length > 0
}

async function notify(urls, opts) {
    const arn = opts.awsSnsArn;
    log.info(`Valid Urls Found, notifying ARN: ${arn}`);
    const client = new SNSClient();
    const response = await client.send(new PublishCommand({
        TargetArn: arn,
        Subject: opts.subject,
        Message: buildMessage(urls)
    }));
    log.info(`Notification Send: ${JSON.stringify(response)}`);
    fs.closeSync(fs.openSync(opts.lockFile, 'w'));
}

function buildMessage(urls) {
    return `Web Page Matches Found:\n\n${urls.join('\n')}`
}

await main();