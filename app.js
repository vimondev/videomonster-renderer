function Exec(shell) {
  return new Promise((resolve, reject) => {
    const exec = require('child_process').exec
    exec(shell, (error, stdout, stderr) => {
      if (error) {
        console.error(`exec error: ${error}`)
      }
      console.log('stdout ', stdout)
      console.log('stderr ', stderr)
      resolve()
    })
  })
}

function sleep(ms) {
  return new Promise((resolve, reject) => {
    setTimeout(resolve, ms)
  })
}

async function func() {
  const fs = require(`fs`)

  function AccessAsync(path) {
    return new Promise((resolve, reject) => {
      fs.access(path, err => {
        if (err) resolve(false)
        else resolve(true)
      })
    })
  }

  function ReadFileAsync(path, options) {
    return new Promise((resolve, reject) => {
      fs.readFile(path, options, (err, data) => {
        if (err) reject(err)
        else resolve(data)
      })
    })
  }

  function RenameAsync(oldPath, newPath) {
    return new Promise((resolve, reject) => {
      fs.rename(oldPath, newPath, err => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  function WriteFileAsync(path, data) {
    return new Promise((resolve, reject) => {
      fs.writeFile(path, data, err => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  function MkdirAsync(path) {
    return new Promise((resolve, reject) => {
      fs.mkdir(path, err => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  function DeleteMediaCache() {
    return new Promise(resolve => {
      const mediaCacheDir = require('os').homedir() + '\\AppData\\Roaming\\Adobe\\Common\\Media Cache Files'

      fs.access(mediaCacheDir, err => {
        if (err) return resolve()

        fs.readdir(mediaCacheDir, (err, files) => {
          if (err) return resolve()

          files.forEach(file => {
            fs.unlinkSync(mediaCacheDir + '\\' + file)
          })

          resolve()
        })
      })
    })
  }

  async function createFolder(folderPath) {
    try {
      if (!await AccessAsync(folderPath)) {
        await MkdirAsync(folderPath)
      }
    }
    catch (e) {
      console.log(e)
    }
  }

  const config = require(`./config`)
  const video = require(`./modules/video`)
  const global = require(`./global`)
  const fsAsync = require(`./modules/fsAsync`)

  console.log(`start!`)

  await DeleteMediaCache()
  await global.ClearTask()

  const socket = require(`socket.io-client`)(`http://10.0.0.7:3000`, {
    transports: [`websocket`]
  })

  const ERenderStatus = {
    NONE: 0,
    VIDEO: 1,
    AUDIO: 2,
    MAKEMP4: 3
  }
  let renderStatus = 0

  let renderStartedTime = null

  // let isImageRendering = false
  let isTemplateConfirmRendering = false  // 현재 렌더러가 Template Confirm Rendering을 수행하는지 여부

  let isAudioRendering = false    // 오디오 렌더링 수행중?
  let isVideoRendering = false    // 비디오 렌더링 수행중?
  let isMerging = false           // 비디오 Merging 수행중?

  socket.on(`connect`, () => {
    console.log(`Connected!`)
    console.log(`videoclient`)
    socket.emit(`regist`, `videoclient`)
  })

  socket.on(`disconnect`, () => {
    console.log(`Disconnected!`)
  })

  // 렌더 서버에서 클라이언트가 네트워크 문제 등의 이유로 재접속 되었을 때, 작업을 수행중인지 물어본다.
  // 만약 작업을 수행하고 있지 않다면 (VM이 재부팅되거나, 프로세스가 다시 시작되었을 경우) 에러 코드를 서버에 전송한다.
  // Template Confirm Rendering 수행 여부 확인
  socket.on(`is_stopped_template_confirm_rendering`, async data => {
    const { currentGroupIndex } = data
    if (isTemplateConfirmRendering == false) {
      socket.emit(`template_confirm_render_completed`, {
        currentGroupIndex,
        errCode: `ERR_TEMPLATE_CONFIRM_RENDER_STOPPED`
      })
    }
  })

  // Audio Rendering 수행 여부 확인
  socket.on(`is_stopped_audio_rendering`, async data => {
    const { currentGroupIndex } = data
    if (isAudioRendering == false) {
      socket.emit(`audio_render_completed`, {
        currentGroupIndex,
        errCode: `ERR_AUDIO_RENDER_STOPPED`
      })
    }
  })

  // Video Rendering 수행 여부 확인
  socket.on(`is_stopped_video_rendering`, async data => {
    const { currentGroupIndex } = data
    if (isVideoRendering == false) {
      socket.emit(`video_render_completed`, {
        currentGroupIndex,
        errCode: `ERR_VIDEO_RENDER_STOPPED`
      })
    }
  })

  // Video Merging 수행 여부 확인
  socket.on(`is_stopped_merging`, async data => {
    const { currentGroupIndex } = data
    if (isMerging == false) {
      socket.emit(`merge_completed`, {
        currentGroupIndex,
        errCode: `ERR_MERGE_STOPPED`
      })
    }
  })

  // Template Confirm Render 시작
  socket.on(`template_confirm_render_start`, async (data) => {
    isTemplateConfirmRendering = true
    let {
      currentGroupIndex,

      aepPath,
      audioPath,
      videoPath,
      fontPath,
      
      width,
      height,

      frameRate,
      hashTagString,
      totalFrameCount,
      time
    } = data

    let startFrame = 0
    let endFrame = totalFrameCount - 1

    console.log(data)

    try {
      await global.ClearTask()

      // AEP 파일이 존재하는지 검사한다. (10초 내로 찾지 못하면 에러 코드를 전송한다.)
      for (let i = 0; i < 10; i++) {
        console.log(`Check aep path...`)
        if (await AccessAsync(aepPath)) break
        await sleep(1000)
        if (i == 9) throw `ERR_NO_AEP_FILE`
      }

      // Rendered Frame Count 0으로 초기화 (렌더링 진행률 보고)
      video.ResetTotalRenderedFrameCount()
      renderStatus = ERenderStatus.AUDIO
      renderStartedTime = Date.now()
      ReportProgress(currentGroupIndex, 0)

      // 폰트 설치
      if (await fsAsync.IsExistAsync(config.fontPath)) {
        await fsAsync.UnlinkFolderRecursive(config.fontPath)
      }
      await createFolder(config.fontPath)
      await global.InstallFont(fontPath)

      // 오디오 렌더링
      await video.AudioRender(aepPath, audioPath, totalFrameCount)

      // 비디오 렌더링 (모든 프레임을 TIFF 파일로 전부 뽑아낸다.)
      renderStatus = ERenderStatus.VIDEO
      const res = await video.VideoRender(0, aepPath, startFrame, endFrame, hashTagString)

      // 각 Frame별 렌더링 시간을 계산한다.
      const frameDuration = {}
      let totalTime = 0
      Object.keys(res).forEach(key => {
        const ms = res[key]
        const newKey = startFrame + Number(key) - 1

        frameDuration[newKey] = ms
        totalTime += ms
      })
      Object.keys(frameDuration).forEach(key => {
        frameDuration[key] /= totalTime
      })

      // 모든 TIFF 파일을 취합하여 h264로 인코딩한다.
      renderStatus = ERenderStatus.MAKEMP4
      await video.MakeMP4(0, videoPath, hashTagString, frameRate)

      // Merge를 수행한다. (Template Confirm Rendering은 렌더러를 1개만 사용하므로 Merge는 별로 의미가 없음.)
      await video.Merge(1, videoPath)
      // 비디오 파일에 Audio를 입힌다.
      await video.ConcatAudio(videoPath, audioPath, time)

      await video.ResizeMP4(`${videoPath}/result.mp4`, width, height, 1 / 6)

      socket.emit(`template_confirm_render_completed`, {
        currentGroupIndex,
        frameDuration,
        errCode: null
      })
    }
    catch (e) {
      console.log(e)
      socket.emit(`template_confirm_render_completed`, {
        currentGroupIndex,
        frameDuration: null,
        errCode: e
      })
    }
    renderStatus = ERenderStatus.NONE
    isTemplateConfirmRendering = false
    renderStartedTime = null
  })

  // 비디오 분산 렌더링 시작
  socket.on(`video_render_start`, async (data) => {
    isVideoRendering = true
    let {
      currentGroupIndex,
      rendererIndex,

      aepPath,
      videoPath,
      fontPath,

      startFrame,
      endFrame,
      frameRate,
      hashTagString,

      installFontMap
    } = data

    console.log(data)

    try {
      await global.ClearTask()

      // AEP 파일이 존재하는지 검사한다. (10초 내로 찾지 못하면 에러 코드를 전송한다.)
      for (let i = 0; i < 10; i++) {
        console.log(`Check aep path...`)
        if (await AccessAsync(aepPath)) break
        await sleep(1000)
        if (i == 9) throw `ERR_NO_AEP_FILE`
      }

      // Rendered Frame Count 0으로 초기화 (렌더링 진행률 보고)
      video.ResetTotalRenderedFrameCount()
      renderStatus = ERenderStatus.VIDEO
      renderStartedTime = Date.now()
      ReportProgress(currentGroupIndex, rendererIndex)

      // 폰트 설치
      if (await fsAsync.IsExistAsync(config.fontPath)) {
        await fsAsync.UnlinkFolderRecursive(config.fontPath)
      }
      await createFolder(config.fontPath)

      await global.InstallFont(fontPath)
      if (typeof installFontMap === 'object') await global.InstallGlobalFont(installFontMap)

      // 비디오 렌더링 (프레임을 TIFF 파일로 전부 뽑아낸다.)
      // startFrame, endFrame까지 뽑아낸다.
      await video.VideoRender(rendererIndex, aepPath, startFrame, endFrame, hashTagString)

      // 렌더링한 TIFF 파일들을 취합하여 h264로 인코딩한다.
      renderStatus = ERenderStatus.MAKEMP4
      await video.MakeMP4(rendererIndex, videoPath, hashTagString, frameRate)

      socket.emit(`video_render_completed`, {
        currentGroupIndex,
        errCode: null
      })
    }
    catch (e) {
      console.log(e)
      socket.emit(`video_render_completed`, {
        currentGroupIndex,
        errCode: e
      })
    }
    renderStatus = ERenderStatus.NONE
    isVideoRendering = false
    renderStartedTime = null
  })

  // 1초에 한번씩 렌더서버에 진행률을 보고한다.
  function ReportProgress(currentGroupIndex, rendererIndex) {
    if (renderStatus != ERenderStatus.NONE) {
      if (renderStartedTime != null) {
        // 템플릿 컨펌 렌더링 2시간동안 멈출경우 프로세스 중지
        if (isTemplateConfirmRendering && Date.now() - renderStartedTime > 2 * 60 * 60 * 1000) {
          console.error('TEMPLATE_CONFIRM_RENDER_STOPPED')
          process.exit(1)
        }
        // 비디오 렌더링 1시간동안 멈출경우 프로세스 중지
        else if (isVideoRendering && Date.now() - renderStartedTime > 1 * 60 * 60 * 1000) {
          console.error('VIDEO_RENDER_STOPPED')
          process.exit(1)
        }
      }

      switch (renderStatus) {
        case ERenderStatus.VIDEO:
        case ERenderStatus.MAKEMP4:
          socket.emit(`report_progress`, {
            currentGroupIndex,
            renderStatus,
            renderedFrameCount: video.GetTotalRenderedFrameCount()
          })
          break
      }

      setTimeout(ReportProgress, 1000, currentGroupIndex, rendererIndex)
    }
  }

  // Merging 시작 (분산 렌더링된 영상 파일들을 하나로 합치는 작업)
  // 렌더러 그룹의 각 0번 렌더러가 단독으로 수행
  socket.on(`merge_start`, async (data) => {
    isMerging = true
    const {
      currentGroupIndex,
      rendererCount,
      aepPath,
      videoPath,
      audioPath,
      audioReplaceInfo,
      width,
      height,
      watermarkPath,
      watermarkPath2,
      customWatermark,
      isUseWatermark,
      time,
      totalFrameCount,
      isFootageAudioEnabled
    } = data
    console.log(data)
    try {
      // 분산 렌더링된 영상들을 하나로 합친다.
      await video.Merge(rendererCount, videoPath)

      let videoStartTime, audioStartTime, concatAudioPath = audioPath

      // 오디오 덮어씌우기를 한 경우 페이드인 페이드아웃 처리를 먼저 해준다.
      if (audioReplaceInfo) {
        const encodedAudioPath = `${videoPath}/encodedAudio.m4a`
        await video.AudioEncoding(audioReplaceInfo.path, encodedAudioPath)

        // 영상에 유저 오디오를 입힌다.
        const generatedAudioPath = await video.AudioFadeInOut(encodedAudioPath, audioReplaceInfo.StartTime, audioReplaceInfo.FadeDuration, time, audioReplaceInfo.Volume)
        
        let seconds = Math.floor(audioReplaceInfo.StartTime % 60)
        let minuts = Math.floor(audioReplaceInfo.StartTime / 60)
        let milliseconds = (audioReplaceInfo.StartTime - Math.floor(audioReplaceInfo.StartTime)).toFixed(3)
        seconds = seconds < 10 ? `0` + seconds : seconds
        minuts = minuts < 10 ? `0` + minuts : minuts
        milliseconds = milliseconds > 0 ? milliseconds * 1000 : 0
        if (milliseconds === 0) milliseconds = `000`
        else if (milliseconds < 10) milliseconds = `00${milliseconds}` 
        else if (milliseconds < 100) milliseconds = `0${milliseconds}`
        
        videoStartTime = `00:00:00.000`
        audioStartTime = `00:${minuts}:${seconds}.${milliseconds}`
        concatAudioPath = generatedAudioPath
      }

      await video.ConcatAudio(videoPath, concatAudioPath, time, videoStartTime, audioStartTime)

      if (isFootageAudioEnabled) {
        const combineVideoPath = `${videoPath}/combine.mp4`, combineAudioPath = `${videoPath}/combine.aif`
        await RenameAsync(`${videoPath}/result.mp4`, combineVideoPath)

        await video.AudioRender(aepPath, combineAudioPath, totalFrameCount)
        await video.CombineAudio(videoPath, combineAudioPath)
      }

      await video.ResizeMP4(`${videoPath}/result.mp4`, width, height, 1 / 6)

      if (isUseWatermark) {
        const scaledWatermarkFileName = 'scaledwatermark.png'

        if (customWatermark) {
          const sealedFileName = 'sealed.mp4'
          const { width: watermarkWidth, height: watermarkHeight, left, top, right, bottom } = customWatermark.transform

          const { scaleFactor, scaledWatermarkWidth, scaledWatermarkHeight } = await video.ScaleWatermark(customWatermark.path, watermarkWidth, watermarkHeight, videoPath, width, height, scaledWatermarkFileName)

          let scaledGapX = 0, scaledGapY = 0
          let watermarkPositionX = 0, watermarkPositionY = 0

          if (!isNaN(Number(left))) {
            scaledGapX = Math.floor(left * scaleFactor)
            watermarkPositionX = scaledGapX
          }
          else if (!isNaN(Number(right))) {
            scaledGapX = Math.floor(right * scaleFactor)
            watermarkPositionX = width - scaledWatermarkWidth - scaledGapX
          }

          if (!isNaN(Number(top))) {
            scaledGapY = Math.floor(top * scaleFactor)
            watermarkPositionY = scaledGapY
          }
          else if (!isNaN(Number(bottom))) {
            scaledGapY = Math.floor(bottom * scaleFactor)
            watermarkPositionY = height - scaledWatermarkHeight - scaledGapY
          }

          await video.PutWatermark(videoPath, 'result.mp4', sealedFileName, scaledWatermarkFileName, watermarkPositionX, watermarkPositionY)
        }
        else {
          // 좌측 하단 워터마크
          if (watermarkPath) {
            let sealedFileName = 'sealed.mp4'
            if (watermarkPath2) sealedFileName = 'temp.mp4'
  
            const { scaleFactor, scaledWatermarkHeight } = await video.ScaleWatermark(watermarkPath, 275, 115, videoPath, width, height, scaledWatermarkFileName)
  
            const scaledGapX = Math.floor(70 * scaleFactor)
            const scaledGapY = Math.floor(60 * scaleFactor)
  
            const watermarkPositionX = scaledGapX
            const watermarkPositionY = height - scaledWatermarkHeight - scaledGapY
  
            await video.PutWatermark(videoPath, 'result.mp4', sealedFileName, scaledWatermarkFileName, watermarkPositionX, watermarkPositionY)
          }
          // 우측 상단 워터마크
          if (watermarkPath2) {
            let originalFileName = 'result.mp4'
            if (watermarkPath) {
              originalFileName = 'temp.mp4'
            }
  
            const { scaleFactor, scaledWatermarkWidth } = await video.ScaleWatermark(watermarkPath2, 244, 60, videoPath, width, height, scaledWatermarkFileName)
  
            const scaledGapX = Math.floor(40 * scaleFactor)
            const scaledGapY = Math.floor(40 * scaleFactor)
  
            const watermarkPositionX = width - scaledWatermarkWidth - scaledGapX
            const watermarkPositionY = scaledGapY
  
            await video.PutWatermark(videoPath, originalFileName, 'sealed.mp4', scaledWatermarkFileName, watermarkPositionX, watermarkPositionY)
          }
        }

        await video.ResizeMP4(`${videoPath}/sealed.mp4`, width, height, 1 / 6)
      }

      socket.emit(`merge_completed`, {
        currentGroupIndex,
        errCode: null
      })
    }
    catch (e) {
      console.log(e)
      socket.emit(`merge_completed`, {
        currentGroupIndex,
        errCode: e
      })
    }

    isMerging = false
  })

  // 프로세스 강제 종료 (긴급용)
  socket.on(`kill_process`, async () => {
    process.exit(1)
  })
}

func()