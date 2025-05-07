
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
    
    async Exec(args, cookiesPath, progressCallback) {
        return new Promise((resolve, reject) => {
            this.ytDlpWrap.exec([
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
    
    async ExecPromise(args, cookiesPath) {
        return this.ytDlpWrap.execPromise([
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