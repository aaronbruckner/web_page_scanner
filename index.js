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
 *   node index.js --urls https://www.google.com --invalidWords "Out of stock" --awsSnsArn arn:aws:sns:us-west-2:11111111:Alert --subject "IN STOCK ALERT" --lockFile /home/ubuntu/lock.txt 
 */
async function main() {
    log.info('Web Page Scanner');

    program
        .requiredOption('-u, --urls [urls...]', 'Specifies the webpages to scan. Each URL provided will be processed')
        .requiredOption('-i, --invalidWords [words...]', 'If all the provided words are missing from the page, a notification will be sent.')
        .requiredOption('-a, --awsSnsArn [arn]', 'If matches are found, the provided AWS SNS Arn will be notified.')
        .requiredOption('-s, --subject [subject]', 'If a notification is sent, this will be used as the subject line.')
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
    log.info('Page Loaded');

    const content = await page.content();

    log.debug(`Page Content:\n\n${content}\n\n`);
    await page.close();

    return isValidPage(content, opts);
}

async function isValidPage(content, opts) {
    for (const invalidWord of opts.invalidWords) {
        if (content.includes(invalidWord)) {
            log.info(`Page contained invalid word: "${invalidWord}"`)
            return false;
        }
    }
    
    return true;
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