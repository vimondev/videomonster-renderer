
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
    
    /**
     * REFERENCE : https://github.com/yt-dlp/yt-dlp#workarounds
     * 
     * --sleep-requests : request 사이 대기시간
     * --min-sleep-interval : 비디오 / 오디오 다운로드 최소 대기시간
     * --max-sleep-interval : 비디오 / 오디오 다운로드 최대 대기시간
     * --file-access-retries : 파일 접근 실패 시 재시도 횟수
     * --retry-sleep : 파일 접근 실패 시 대기시간
     * --cookies : 쿠키 파일 경로
     */
    async Exec(args, cookiesPath, progressCallback) {
        return new Promise((resolve, reject) => {
            this.ytDlpWrap.exec([
                '--sleep-requests', '3',
                '--min-sleep-interval', '5',
                '--max-sleep-interval', '10',
                '--file-access-retries', '5',
                '--retry-sleep', 'fragment:10',
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
            '--sleep-requests', '3',
            '--min-sleep-interval', '5',
            '--max-sleep-interval', '10',
            '--file-access-retries', '5',
            '--retry-sleep', 'fragment:10',
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