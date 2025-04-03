
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