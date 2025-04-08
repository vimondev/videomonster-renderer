exports.ERenderStatus = {
    NONE: 0,        // 렌더링 중이지 않음. (또는 렌더링 완료됨)
    VIDEO: 1,       // 비디오 렌더링 중
    AUDIO: 2,
    MAKEMP4: 3,
    MERGE: 4,       // 비디오 합치는 중,
    IMAGE: 5,
    MATERIAL_PARSE: 6,
    GIF: 7,
    DOWNLOAD_YOUTUBE_METADATA: 8,
    DOWNLOAD_YOUTUBE_PREVIEW_FILES: 9,
    EXTRACT_THUMBNAILS_FROM_YOUTUBE_FILE: 10,
    EXTRACT_POSTERS_FROM_YOUTUBE_FILE: 11,
    GENERATE_YOUTUBE_SHORTS: 12,
}

exports.EEncodeStatus = {
    NONE: 0,
    IMAGE: 1,
    VIDEO: 2,
}