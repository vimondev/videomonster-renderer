/**
 * Product Detail Shosrts Web Crawling
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const cheerio = require('cheerio');
const { minify } = require('html-minifier');
const fsAsync = require('./fsAsync');

// Prevent Electron from showing in the dock on macOS
if (process.platform === 'darwin') {
	app.dock.hide();
}

// Disable GPU acceleration for headless operation
app.disableHardwareAcceleration();

// Disable HTTP/2 protocol
// app.commandLine.appendSwitch('disable-http2');
// Disable web security to bypass some restrictions
// app.commandLine.appendSwitch('disable-web-security');
// // Disable same-origin policy
// app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors');
// // Disable automation detection
// app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');

// When Electron is ready, start crawling
app.on('ready', async () => {
	try {
		// Handle command line arguments
		const argsString = process.argv.slice(2)[0];
		const args = argsString.split('___');
		const url = args[0];
		const targetFolderPath = args[1] || path.join(__dirname, '../temp');
		const extractHtmlFileName = args[2] || 'clean.html';
		const sourcesJsonFileName = args[3] || 'sources.json';

		if (!url) {
			console.log('[Electron] Error: URL is required');
			process.exit(1);
		}
				
		// Create target directory if it doesn't exist
		await fsAsync.Mkdirp(targetFolderPath);

		// Create browser window
		const win = new BrowserWindow({
			width: 1920,
			height: 1080,
			show: false,
			webPreferences: {
				nodeIntegration: false,
				contextIsolation: true,
				javascript: true,
				webSecurity: false
			}
		});

		// Set user agent
		const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';
		await win.webContents.session.setUserAgent(userAgent);

		// Handle dialog events
		win.webContents.on('dialog', (event) => {
			event.preventDefault();
		});

		// Load the URL
		await win.loadURL(url, {
			userAgent,
			extraHeaders: 'pragma: no-cache\n'
		});

		// Wait for page to fully load with domcontentloaded and additional safety time
		await new Promise((resolve) => {
			const timeout = setTimeout(resolve, 5000); // 최대 5초 대기
			
			win.webContents.once('dom-ready', () => {
				// DOM이 준비되면 추가로 2초 더 대기 (동적 컨텐츠 로딩)
				setTimeout(() => {
					clearTimeout(timeout);
					resolve();
				}, 2000);
			});
		});

		// Get full HTML
		const fullHtml = await win.webContents.executeJavaScript(`document.documentElement.outerHTML`);

		// Extract sources
		const sources = await win.webContents.executeJavaScript(`
			(() => {
				const images = Array.from(document.querySelectorAll('img')).map((img, index) => ({
					index: index,
					url: img.src || img.currentSrc,
					alt: img.alt || '',
					width: img.naturalWidth || img.width,
					height: img.naturalHeight || img.height
				}));

				const videos = Array.from(document.querySelectorAll('video, video source')).map((video, index) => ({
					index: index,
					url: video.src || video.currentSrc,
					alt: video.alt || ''
				}));

				return { images, videos };
			})()
		`);
		
		const _urlFormatter = (imageUrl) => {
			let url = imageUrl.split('?')[0];

			if (!url.includes('https://') && !url.includes('http://')) {
				if (url.startsWith('://')) url = `https${url}`;
				else if (url.startsWith('//')) url = `https:${url}`;
				else if (url.startsWith('/')) url = `https:/${url}`;
				else if (url.startsWith('.')) url = `https://${url}`;
			}

			return url;
		}
		
		const urlFormatJson = {
			images: sources.images.map(image => ({
				index: image.index,
				url: _urlFormatter(image.url)
			})),
			videos: sources.videos.map(video => ({
				index: video.index,
				url: _urlFormatter(video.url)
			})),
		}
		// Save sources
		const sourcesJsonFilePath = path.join(targetFolderPath, sourcesJsonFileName);
		await fsAsync.WriteFileAsync(sourcesJsonFilePath, JSON.stringify(urlFormatJson, null, 2));

		// Clean HTML with cheerio
		const $ = cheerio.load(fullHtml);

		// Remove unnecessary elements
		$('style, script, meta[name="viewport"], meta[name="robots"], svg, link, a').remove();
		$('*[style]').removeAttr('style');

		// Remove unnecessary attributes
		$('*').each(function () {
			const el = $(this);
			const attribs = Object.keys(el.attr() || {});
			attribs.forEach(attr => {
				if (!['src', 'href', 'alt', 'title', 'id', 'class'].includes(attr)) {
					el.removeAttr(attr);
				}
			});
		});

		// Clean and minify HTML
		const cleanHtml = $.html()
			.replace(/<!--[\s\S]*?-->/g, '')
			.replace(/^\s*[\r\n]/gm, '');

		const minifiedHtml = minify(cleanHtml, {
			collapseWhitespace: true,
			removeComments: true,
			removeEmptyAttributes: true,
			removeRedundantAttributes: true,
			removeScriptTypeAttributes: true,
			removeStyleLinkTypeAttributes: true,
			minifyCSS: true,
			minifyJS: true,
			useShortDoctype: true,
			processConditionalComments: true
		});

		// Save cleaned HTML
		const extractHtmlFilePath = path.join(targetFolderPath, extractHtmlFileName);
		await fsAsync.WriteFileAsync(extractHtmlFilePath, minifiedHtml);
		
		// Output result as JSON for parent process
		console.log(JSON.stringify({
			extractHtmlFilePath,
			sourcesJsonFilePath
		}));

		// Close window and quit app
		win.close();
		process.exit(0);
	} catch (err) {
		console.log('[Electron] Error:', err);
		process.exit(1);
	}
});