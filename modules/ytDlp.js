
const YTDlpWrap = require('yt-dlp-wrap').default
const fsAsync = require('./fsAsync')
const { ytDlpDirPath } = require('../config')
const ytDlpBinaryPath = `${ytDlpDirPath}/yt-dlp-binary.exe`

class YTDlp {
    static instance = null

    constructor() {
        if (YTDlp.instance) {
            return YTDlp.instance
        }

        YTDlp.instance = this
        this.ytDlpWrap = new YTDlpWrap(ytDlpBinaryPath)
    }
    
    async DownloadBinary() {
        await fsAsync.MkdirAsync(ytDlpDirPath)
        await YTDlpWrap.downloadFromGithub(ytDlpBinaryPath);
    }
    
    async Exec(args, cookiesPath, poToken, progressCallback) {
        return new Promise((resolve, reject) => {
            /**
             * REFERENCE : https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide#with-an-account
             */
            this.ytDlpWrap.exec([
                '--extractor-args', `youtube:po_token=web.gvs+${poToken}`,
                '--cookies', cookiesPath,
                ...args
            ])
            .on('progress', progress => {
                if (typeof progressCallback === 'function') {
                    progressCallback(progress.percent)
                }
            })
            .on('ytDlpEvent', (eventType, eventData) =>
                console.log(eventType, eventData)
            )
            .on('error', reject)
            .on('close', resolve)
        })
    }
    
    async ExecPromise(args, poToken, cookiesPath) {
        /**
         * REFERENCE : https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide#with-an-account
         */
        return this.ytDlpWrap.execPromise([
            '--extractor-args', `youtube:po_token=web.gvs+${poToken}`,
            '--cookies', cookiesPath,
            ...args
        ])
    }

    getBinaryPath() {
        return this.ytDlpWrap.getBinaryPath()
    }
}

const instance = new YTDlp()
module.exports = instance