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
  require(`dotenv`).config()

  const config = require(`./config`)
  const video = require(`./modules/video`)
  // const image = require(`./modules/image`)
  const global = require(`./global`)

  let token = ``
  if (fs.existsSync(config.tokenPath)) {
    token = fs.readFileSync(config.tokenPath, 'utf8')
  }
  else {
    token = require(`guid`).create().value
    fs.writeFileSync(config.tokenPath, token)
  }

  console.log(`start!`)

  const socket = require(`socket.io-client`)(`http://10.0.0.8:3000`, {
    transports: [`websocket`],
    query: {
      token: token
    }
  })

  const {
    localPath
  } = config

  const ERenderStatus = {
    NONE: 0,
    VIDEO: 1,
    AUDIO: 2,
    MAKEMP4: 3
  }
  let renderStatus = 0

  // let isImageRendering = false
  let isAudioRendering = false
  let isVideoRendering = false
  let isMerging = false

  socket.on(`connect`, () => {
    console.log(`Connected!`)
    console.log(process.env.SECRETKEY)
    socket.emit(`regist`, process.env.SECRETKEY)
  })

  socket.on(`disconnect`, () => {
    console.log(`Disconnected!`)
  })

  // socket.on(`is_stopped_image_rendering`, async data => {
  //   if (isImageRendering == false) {
  //     socket.emit(`image_render_completed`, {
  //       errCode: `ERR_IMAGE_RENDER_STOPPED`
  //     })
  //   }
  // })

  socket.on(`is_stopped_audio_rendering`, async data => {
    const { currentGroupIndex } = data
    if (isAudioRendering == false) {
      socket.emit(`audio_render_completed`, {
        currentGroupIndex,
        errCode: `ERR_AUDIO_RENDER_STOPPED`
      })
    }
  })
  
  socket.on(`is_stopped_video_rendering`, async data => {
    const { currentGroupIndex } = data
    if (isVideoRendering == false) {
      socket.emit(`video_render_completed`, {
        currentGroupIndex,
        errCode: `ERR_VIDEO_RENDER_STOPPED`
      })
    }
  })
  
  socket.on(`is_stopped_merging`, async data => {
    const { currentGroupIndex } = data
    if (isMerging == false) {
      socket.emit(`merge_completed`, {
        currentGroupIndex,
        errCode: `ERR_MERGE_STOPPED`
      })
    }
  })

  // socket.on(`image_render_start`, async (data) => {
  //   isImageRendering = false

  //   const {
  //     aepPath,
  //     imagePath,
  //     fontPath,
  //     imageList
  //   } = data

  //   console.log(data)

  //   try {
  //     global.InstallFont(fontPath)

  //     for (let i = 0; i < 10; i++) {
  //       console.log(`Check aep path...`)
  //       if (fs.existsSync(aepPath)) break
  //       await sleep(1000)
  //       if (i == 9) throw `ERR_NO_AEP_FILE`
  //     }

  //     console.log(`start image render!`)
  //     await image.ImageRender(aepPath, imageList)
  //     console.log(`start image convert!`)
  //     await image.ConvertTIFFToPng(imagePath, imageList)
  //     console.log(`image render completed!`)

  //     socket.emit(`image_render_completed`, {
  //       errCode: null
  //     })
  //   }
  //   catch (e) {
  //     console.log(e)

  //     socket.emit(`image_render_completed`, {
  //       errCode: e
  //     })
  //   }
  //   isImageRendering = false
  // })
  
  socket.on(`audio_render_start`, async (data) => {
    isAudioRendering = true
    let {
      currentGroupIndex,

      aepPath,
      audioPath,
      
      totalFrameCount
    } = data

    console.log(data)

    try {
      for (let i = 0; i < 10; i++) {
        console.log(`Check aep path...`)
        if (fs.existsSync(aepPath)) break
        await sleep(1000)
        if (i == 9) throw `ERR_NO_AEP_FILE`
      }

      await video.AudioRender(aepPath, audioPath, totalFrameCount)

      socket.emit(`audio_render_completed`, {
        currentGroupIndex,
        errCode: null
      })
    }
    catch (e) {
      console.log(e)
      socket.emit(`audio_render_completed`, {
        currentGroupIndex,
        errCode: e
      })
    }
    isAudioRendering = false
  })

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
      hashTagString
    } = data

    console.log(data)

    try {
      for (let i = 0; i < 10; i++) {
        console.log(`Check aep path...`)
        if (fs.existsSync(aepPath)) break
        await sleep(1000)
        if (i == 9) throw `ERR_NO_AEP_FILE`
      }
      
      global.InstallFont(fontPath)

      video.ResetTotalRenderedFrameCount()

      renderStatus = ERenderStatus.VIDEO
      ReportProgress(currentGroupIndex, rendererIndex)
      const res = await video.VideoRender(rendererIndex, aepPath, startFrame, endFrame, hashTagString)
      
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

      renderStatus = ERenderStatus.MAKEMP4
      await video.MakeMP4(rendererIndex, videoPath, hashTagString, frameRate)

      socket.emit(`video_render_completed`, {
        currentGroupIndex,
        frameDuration,
        errCode: null
      })
    }
    catch (e) {
      console.log(e)
      socket.emit(`video_render_completed`, {
        currentGroupIndex,
        frameDuration: null,
        errCode: e
      })
    }
    renderStatus = ERenderStatus.NONE
    isVideoRendering = false
  })

  function ReportProgress(currentGroupIndex, rendererIndex) {
    if (renderStatus != ERenderStatus.NONE) {
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

  socket.on(`merge_start`, async (data) => {
    isMerging = true
    const {
      currentGroupIndex,
      rendererCount,
      videoPath,
      audioPath
    } = data
    console.log(data)

    try {
      await video.Merge(rendererCount, videoPath)
      await video.ConcatAudio(videoPath, audioPath)

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
}

func()