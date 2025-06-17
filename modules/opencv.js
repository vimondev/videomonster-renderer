const cv = require('opencv4nodejs-prebuilt');
const path = require('path');
const fsAsync = require('./fsAsync');

const SeparateImage = async ({
	originImageFilePath,
	targetFolderPath,
	targetImageFileNamePrefix,
}) => {
	try {
		// 이미지 읽기
		const image = await cv.imreadAsync(originImageFilePath);
		const originOutputPath = path.join(targetFolderPath, `${targetImageFileNamePrefix}0.jpg`);

		// 세로/가로 비율 체크
		const aspectRatio = image.rows / image.cols;
		if (aspectRatio < 2) {  // 세로가 가로의 2배보다 작으면 처리하지 않음
			await cv.imwriteAsync(originOutputPath, image);
			return [originOutputPath];
		}

		// 그레이스케일 변환 및 이진화
		const gray = image.cvtColor(cv.COLOR_BGR2GRAY);
		// cv.imwrite(path.join(this.debugDir, `${fileName}_1_gray.jpg`), gray);

		// 가우시안 블러 적용
		const blurred = gray.gaussianBlur(new cv.Size(5, 5), 0);
		// cv.imwrite(path.join(this.debugDir, `${fileName}_2_blurred.jpg`), blurred);

		const binary = blurred.threshold(250, 255, cv.THRESH_BINARY);
		// cv.imwrite(path.join(this.debugDir, `${fileName}_3_binary.jpg`), binary);

		// 세로 방향으로 픽셀값 합산
		const rowSums = [];
		const pixelChanges = [];  // 픽셀 변화량을 저장할 배열
		const binaryData = binary.getDataAsArray();
		const grayData = gray.getDataAsArray();

		for (let y = 0; y < binary.rows; y++) {
			const sum = binaryData[y].reduce((acc, val) => acc + val, 0);
			rowSums.push(sum);

			// 인접한 픽셀 간의 변화량 계산
			if (y > 0) {
				let changes = 0;
				for (let x = 0; x < gray.cols; x++) {
					const diff = Math.abs(grayData[y][x] - grayData[y - 1][x]);
					if (diff > 33) {  // 유의미한 변화로 간주할 임계값
						changes++;
					}
				}
				pixelChanges.push((changes / gray.cols) * 100);  // 변화율을 퍼센트로 저장
			}
		}

		// 시각화를 위한 그래프 이미지 생성
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

		// cv.imwrite(path.join(this.debugDir, `${fileName}_4_analysis_graph.jpg`), graph);

		// 분리 지점 찾기
		const whiteThreshold = binary.cols * 253;
		const changeThreshold = 33;  // 픽셀 변화율 임계값 (33%)
		const separationPoints = [0];

		// 분리 지점을 표시한 이미지 생성
		const separationImage = image.copy();

		for (let y = 1; y < rowSums.length - 1; y++) {
			// 흰색 영역 기반 검출
			const isWhiteArea = rowSums[y] > whiteThreshold &&
				rowSums[y - 1] > whiteThreshold &&
				rowSums[y + 1] > whiteThreshold;

			// 픽셀 변화율 기반 검출
			const hasSignificantChange = pixelChanges[y] > changeThreshold;

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

		separationPoints.push(binary.rows);
		// cv.imwrite(path.join(this.debugDir, `${fileName}_5_separation_points.jpg`), separationImage);

		// 분리된 이미지 저장
		const separatedPaths = [];
		for (let i = 0; i < separationPoints.length - 1; i++) {
			const startY = separationPoints[i];
			const endY = separationPoints[i + 1];
			const height = endY - startY;

			if (height < 100) continue;

			// 상단의 흰색 영역 제거
			let adjustedStartY = startY;
			for (let y = startY; y < endY; y++) {
				if (rowSums[y] > whiteThreshold * 0.9) {
					adjustedStartY = y + 1;
				} else {
					break;
				}
			}

			const adjustedHeight = endY - adjustedStartY;
			if (adjustedHeight < 100) continue;

			// 영역 추출
			const roi = image.getRegion(new cv.Rect(
				0,
				adjustedStartY,
				image.cols,
				adjustedHeight
			));

			// 최소 크기 체크 (400px)
			if (roi.cols <= 400 && roi.rows <= 400) {
				continue;
			}

			const outputFileName = `${targetImageFileNamePrefix}${i}.jpg`;
			const outputPath = path.join(targetFolderPath, outputFileName);
			await cv.imwriteAsync(outputPath, roi);
			separatedPaths.push(outputPath);
		}
		
		// 분리된 이미지가 없으면 원본 이미지 저장
		if (separatedPaths.length === 0) {
			await cv.imwriteAsync(originOutputPath, image);
		}
		
		// 메모리 정리
		gray.release();
		blurred.release();
		binary.release();
		graph.release();
		separationImage.release();
		image.release();
		
		if (separatedPaths.length === 0) {
			return [originOutputPath];
		}
		
		return separatedPaths;
	} catch (err) {
		console.error(`[SeparateImage] 이미지 분리 중 오류: ${err}`);
		return [originImageFilePath];
	}
}

module.exports = {
	SeparateImage
}