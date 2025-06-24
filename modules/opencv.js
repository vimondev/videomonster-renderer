const cv = require('opencv4nodejs-prebuilt');
const path = require('path');
const { imageSizeFromFile } = require('image-size/fromFile')

/**
 * 메모리 누수 방지를 위한 모든 Mat 객체 해제 함수
 * @param  {...any} mats 해제할 Mat 객체들
 */
const _SafeRelease = (...mats) => {
	try {
		mats.forEach(mat => {
			if (mat && typeof mat.release === 'function') {
				mat.release();
			}
		});
	}
	catch (err) {
		console.log(`[_SafeRelease] 메모리 정리 중 오류: ${err}`);
	}
};

/**
 * 이미지 파일이 처리 조건을 만족하는지 검사
 * @returns {Promise<boolean>} 처리 가능 여부
 */
const CheckImageSizeValid = async (
	filePath,
) => {
	try {
		// 이미지 필터링 상수
		const MIN_DIMENSION = 480
		const MAX_ASPECT_RATIO = 1.5
		
		// 2. 이미지 크기 정보 가져오기
		const { width, height } = await imageSizeFromFile(filePath);

		// 3. 최소 크기 요구사항 검사 (480x480 이상)
		if (width < MIN_DIMENSION && height < MIN_DIMENSION) {
			return false;
		}

		// 4. 가로/세로 비율 검사 (가로형 이미지 여부)
		const aspectRatio = width / height;
		if (aspectRatio > MAX_ASPECT_RATIO) {
			return false;
		}

		return true;
	} catch (err) {
		return false;
	}
}

/**
 * 긴 세로 이미지를 여러 개의 작은 이미지로 자동 분리하는 함수
 * 흰색 줄과 픽셀 변화량을 분석하여 분리점을 찾음
 * 
 * @param {string} originImageFilePath - 원본 이미지 파일 경로
 * @param {string} targetFolderPath - 분리된 이미지들을 저장할 폴더 경로
 * @param {string} targetImageFileNamePrefix - 생성될 파일명의 접두사
 * @returns {Promise<Array<{image: string, smallImage: string, width: number, height: number}>>} 분리된 이미지 정보 배열 
 */
const SeparateImage = async ({
	originImageFilePath,
	targetFolderPath,
	targetImageFileNamePrefix,
}) => {
	// OpenCV Mat 객체들 - 메모리 관리를 위해 finally에서 해제
	let image = null;
	let smallImage = null;
	let gray = null;
	let blurred = null;
	let binary = null;
	let graph = null;
	let separationImage = null;

	try {
		// === 설정 상수들 ===
		const MAX_WIDTH = 1024;			// 처리할 최대 이미지 너비
		const SMALL_IMAGE_RATIO = 0.25;		// 작은 이미지 비율
		
		const WHITE_LINE_VALUE = 253;		// 흰색 줄 감지 임계값
		const MIN_SLICE_HEIGHT = 100;		// 분리된 조각의 최소 높이
		const MIN_SLICE_SIZE = 480;		// 분리된 조각의 최소 크기
		const CHANGE_THRESHOLD = 33;		// 픽셀 변화 감지 임계값
		const MAX_COLS_ASPECT_RATIO = 1.5;	// 가로 비율 최대값
		
		// 원본 이미지 로드
		try {
			image = await cv.imreadAsync(originImageFilePath);
		} catch (err) { 
			return []
		}
		
		const originOutputPath = path.join(targetFolderPath, `${targetImageFileNamePrefix}0.jpg`);
		const originOutputSmallPath = path.join(targetFolderPath, `${targetImageFileNamePrefix}0_small.jpg`);

		// 이미지 리사이즈 헬퍼 함수
		const _resizeMatByRatio = (mat, ratio) => {
			const newWidth = Math.round(mat.cols * ratio);
			const newHeight = Math.round(mat.rows * ratio);
			
			return mat.resize(newHeight, newWidth);
		};

		// === 1단계: 이미지 크기 조정 ===
		// 너비가 MAX_WIDTH를 초과하면 비율에 맞게 축소
		if (image.cols > MAX_WIDTH) {
			const scale = MAX_WIDTH / image.cols;
			image = _resizeMatByRatio(image, scale);
		}

		// 썸네일용 작은 이미지 생성
		smallImage = _resizeMatByRatio(image, SMALL_IMAGE_RATIO);

		// === 2단계: 세로/가로 비율 체크 ===
		// 비율이 가로:세로 기준 2:1 미만이면 분리할 필요가 없다고 판단
		const aspectRatio = image.rows / image.cols;
		if (aspectRatio < 2) {
			await cv.imwriteAsync(originOutputPath, image);
			await cv.imwriteAsync(originOutputSmallPath, smallImage);
			return [{
				image: originOutputPath,
				smallImage: originOutputSmallPath,
				width: image.cols,
				height: image.rows,
			}];
		}

		// === 3단계: 이미지 전처리 ===
		// 그레이스케일 변환 -> 가우시안 블러 -> 이진화
		gray = image.cvtColor(cv.COLOR_BGR2GRAY);
		blurred = gray.gaussianBlur(new cv.Size(5, 5), 0);	// 노이즈 제거
		binary = blurred.threshold(250, 255, cv.THRESH_BINARY);	// 흰색 영역만 추출

		// === 4단계: 행별 분석 데이터 수집 ===
		const rowSums = [];		// 각 행의 흰색 픽셀 합계
		const pixelChanges = [];  // 픽셀 변화량을 저장할 배열
		const binaryData = binary.getDataAsArray();
		const grayData = gray.getDataAsArray();

		// 각 행을 분석하여 흰색 정도와 변화량 계산
		for (let y = 0; y < binary.rows; y++) {
			// 해당 행의 모든 픽셀 값 합계 (흰색일수록 큰 값)
			const sum = binaryData[y].reduce((acc, val) => acc + val, 0);
			rowSums.push(sum);

			// 인접한 픽셀 간의 변화량 계산
			if (y > 0) {
				let changes = 0;
				for (let x = 0; x < gray.cols; x++) {
					const diff = Math.abs(grayData[y][x] - grayData[y - 1][x]);
					if (diff > CHANGE_THRESHOLD) {   // 유의미한 변화로 간주할 임계값
						changes++;
					}
				}
				pixelChanges.push((changes / gray.cols) * 100);  // 변화율을 퍼센트로 저장
			}
		}
		// === 5단계: 시각화를 위한 그래프 이미지 생성 ===
		const graphHeight = 400;
		const graphWidth = binary.cols;
		// 흰색 배경의 3채널 이미지 생성
		const graph = new cv.Mat(graphHeight, graphWidth, cv.CV_8UC3);
		graph.setTo(new cv.Vec(255, 255, 255));  // 흰색으로 채우기

		// rowSums 그래프 그리기 (파란색)
		const maxSum = Math.max(...rowSums);
		for (let x = 0; x < rowSums.length; x++) {
			const normalizedHeight = Math.floor((rowSums[x] / maxSum) * graphHeight);
			graph.drawLine(
				new cv.Point2(x, graphHeight),
				new cv.Point2(x, graphHeight - normalizedHeight),
				new cv.Vec(255, 0, 0),  // BGR 형식, 파란색
				1
			);
		}

		// pixelChanges 그래프 그리기 (빨간색)
		for (let x = 0; x < pixelChanges.length; x++) {
			const normalizedHeight = Math.floor((pixelChanges[x] / 100) * graphHeight);
			graph.drawLine(
				new cv.Point2(x, graphHeight),
				new cv.Point2(x, graphHeight - normalizedHeight),
				new cv.Vec(0, 0, 255),  // BGR 형식, 빨간색
				1
			);
		}

		// === 6단계: 분리점 찾기 ===
		const whiteThreshold = binary.cols * WHITE_LINE_VALUE;	// 흰색 줄 판단 기준
		const separationPoints = [0];	// 분리점 위치들 (첫 시작점 포함)
		// 분리 지점을 표시한 이미지 생성
		separationImage = image.copy();
		
		for (let y = 1; y < rowSums.length - 1; y++) {
			// 흰색 영역 기반 검출
			const isWhiteArea = rowSums[y] > whiteThreshold &&
				rowSums[y - 1] > whiteThreshold &&
				rowSums[y + 1] > whiteThreshold;

			// 픽셀 변화율 기반 검출
			const hasSignificantChange = pixelChanges[y] > CHANGE_THRESHOLD;

			if (isWhiteArea || hasSignificantChange) {
				// 이전 분리점과 너무 가까우면 건너뛰기
				if (separationPoints.length > 0 &&
					y - separationPoints[separationPoints.length - 1] < 50) {
					continue;
				}

				separationPoints.push(y);
				// 분리 지점에 선 그리기 (흰색 영역은 빨간색, 변화율 기반은 녹색)
				separationImage.drawLine(
					new cv.Point2(0, y),
					new cv.Point2(image.cols, y),
					isWhiteArea ? new cv.Vec3(0, 0, 255) : new cv.Vec3(0, 255, 0),
					2
				);
			}
		}
		separationPoints.push(binary.rows);	// 마지막 끝점 추가

		// === 7단계: 이미지 분할 및 저장 ===
		const results = [];

		for (let i = 0; i < separationPoints.length - 1; i++) {
			const startY = separationPoints[i];
			const endY = separationPoints[i + 1];
			const height = endY - startY;
			
			// 너무 작은 조각은 무시
			if (height < MIN_SLICE_HEIGHT) continue;

			// 시작점에서 흰색 영역 건너뛰기 (여백 제거)
			let adjustedStartY = startY;
			for (let y = startY; y < endY; y++) {
				if (rowSums[y] > whiteThreshold * 0.9) {
					adjustedStartY = y + 1;
				} else {
					break;
				}
			}

			const adjustedHeight = endY - adjustedStartY;
			if (adjustedHeight < MIN_SLICE_HEIGHT) continue;

			// 영역 추출
			const roi = image.getRegion(new cv.Rect(
				0,
				adjustedStartY,
				image.cols,
				adjustedHeight
			));

			// 최소 크기 체크 (480px)
			if (
				(roi.cols <= MIN_SLICE_SIZE && roi.rows <= MIN_SLICE_SIZE) ||
				roi.cols / roi.rows > MAX_COLS_ASPECT_RATIO
			) {
				continue;
			}

			// 분리된 이미지와 썸네일 저장
			const fileBase = `${targetImageFileNamePrefix}${i + 1}`;
			const roiPath = path.join(targetFolderPath, `${fileBase}.jpg`);
			const roiSmallPath = path.join(targetFolderPath, `${fileBase}_small.jpg`);
			await cv.imwriteAsync(roiPath, roi);

			const resized = _resizeMatByRatio(roi, SMALL_IMAGE_RATIO);
			await cv.imwriteAsync(roiSmallPath, resized);

			results.push({ image: roiPath, smallImage: roiSmallPath, width: roi.cols, height: roi.rows });

			// 메모리 해제
			roi.release();
			resized.release();
		}

		// === 8단계: 결과 반환 ===
		// 분리된 이미지가 없으면 원본 반환
		if (results.length === 0) {
			await cv.imwriteAsync(originOutputPath, image);
			await cv.imwriteAsync(originOutputSmallPath, smallImage);
			return [{
				image: originOutputPath,
				smallImage: originOutputSmallPath,
				width: image.cols,
				height: image.rows,
			}];
		}

		return results;
	} catch (err) {
		console.log(`[SeparateImage] 이미지 분리 중 오류: ${err}`);
		return [];
	} finally {
		// 메모리 누수 방지를 위한 모든 Mat 객체 해제
		_SafeRelease(
			image,
			smallImage,
			gray,
			blurred,
			binary,
			graph,
			separationImage
		);
	}
};

module.exports = {
	CheckImageSizeValid,
	SeparateImage
}