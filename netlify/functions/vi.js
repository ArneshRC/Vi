const { stream } = require("@netlify/functions");

const fs = require("fs");
const path = require("path");

const cwd = process.cwd();

const FUNNY_ERROR = "Something's not legal :')";

let cachedFrames = null;

function loadFrames() {
	if (cachedFrames) return cachedFrames;

	let framesDir = path.join(cwd, "frames");
	if (!fs.existsSync(framesDir)) {
		framesDir = path.join(cwd, "netlify", "functions", "frames");
	}

	let files = [];
	try {
		files = fs
			.readdirSync(framesDir)
			.filter((f) => f.endsWith(".txt"))
			.sort();
	} catch (err) {
		cachedFrames = [FUNNY_ERROR];
		return cachedFrames;
	}

	const frames = files.map((f) => {
		const content = fs.readFileSync(path.join(framesDir, f), "utf8");
		return content.replace(/\r\n/g, "\n");
	});

	cachedFrames = frames.length ? frames : [FUNNY_ERROR];

	return cachedFrames;
}

const ANSI_COLORS = [
	"\u001b[31m", // red
	"\u001b[33m", // yellow
	"\u001b[32m", // green
	"\u001b[34m", // blue
	"\u001b[35m", // magenta
	"\u001b[36m", // cyan
	"\u001b[37m", // white
];
const ANSI_RESET = "\u001b[0m";

const selectColorIdx = (prevIdx) => {
	const n = ANSI_COLORS.length;
	if (n === 1) return 0;
	let idx;
	do {
		idx = Math.floor(Math.random() * n);
	} while (idx === prevIdx);
	return idx;
};

exports.handler = stream(async (event) => {
	const ua = (event && event.headers && event.headers["user-agent"]) || "";
	if (ua && !ua.includes("curl")) {
		return {
			statusCode: 302,
			headers: {
				Location: "https://github.com/ArneshRC/Vi",
			},
			body: "",
		};
	}

	const qs = event?.queryStringParameters || {};
	const flip = String(qs.flip || "").toLowerCase() === "true";

	const framesRaw = loadFrames();
	const frames = flip
		? framesRaw.map((f) => f.split("").reverse().join(""))
		: framesRaw;

	// Guard: empty frames
	if (!frames || frames.length === 0) {
		return {
			statusCode: 500,
			headers: { "Content-Type": "text/plain; charset=utf-8" },
			body: "No frames available",
		};
	}

	const encoder = new TextEncoder();

	// Capping streaming duration to avoid Netlify 10s limit.
	// Stream for up to ~5000ms
	const MAX_STREAM_MS = 5000;
	const FRAME_DELAY_MS = 70; // parrot.live uses 70ms too
	const clearSeq = "\u001b[2J\u001b[3J\u001b[H";

	const body = new ReadableStream({
		start(controller) {
			let index = 0;
			let lastColor = -1;
			const startTime = Date.now();

			let closed = false;

			const pushNext = async () => {
				// If max time exceeded, close
				if (Date.now() - startTime >= MAX_STREAM_MS) {
					if (!closed) {
						controller.close();
						closed = true;
					}
					return;
				}

				try {
					// Clear screen
					controller.enqueue(encoder.encode(clearSeq));

					// Colorize frame
					const colorIdx = selectColorIdx(lastColor);
					lastColor = colorIdx;
					const coloredFrame = `${ANSI_COLORS[colorIdx]}${frames[index]}${ANSI_RESET}\n`;

					controller.enqueue(encoder.encode(coloredFrame));

					index = (index + 1) % frames.length;
				} catch (err) {
					// If enqueue fails, close the stream
					try {
						controller.error(err);
					} catch (e) {}
					closed = true;
					return;
				}

				setTimeout(() => {
					if (!closed) pushNext();
				}, FRAME_DELAY_MS);
			};

			pushNext();
		},

		cancel(reason) {
			console.log("stream cancelled", reason);
		},
	});

	return {
		statusCode: 200,
		headers: {
			"Content-Type": "text/plain; charset=utf-8",
			"Cache-Control": "no-cache, no-transform",
		},
		body,
	};
});
