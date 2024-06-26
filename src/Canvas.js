customElements.define('custom-canvas', class extends HTMLElement {
	constructor() {
		super();
	}
});

class Canvas {
	#canvas
	#ctx
	#contentHint
	#stream

	#objects = {}
	#undone = {}

	#animate = {
		loop: undefined,
		durations: [],
		windowFPS: 30
	}

	#shadowRoot

	constructor(canvas, {
		alpha = true,
		colorSpace = 'srgb',
		desynchronized = true,
		willReadFrequently = false,
		imageSmoothingEnabled = true,
		imageSmoothingQuality = 'low',
		contentHint = 'motion'
	} = {}) {
		this.#canvas = canvas;
		this.#ctx = canvas.getContext('2d', {
			alpha,
			colorSpace,
			desynchronized,
			willReadFrequently
		});

		this.#ctx.imageSmoothingEnabled = imageSmoothingEnabled;
		this.#ctx.imageSmoothingQuality = imageSmoothingQuality;

		this.#contentHint = contentHint;

		var startTime = performance.now();
		var frameCount = 0;
		var countFrames = () => {
			frameCount++;

			var elapsedTime = performance.now() - startTime;
			if (elapsedTime < 1000) {
				requestAnimationFrame(countFrames);
			} else {
  			this.#animate.windowFPS = parseInt(frameCount / 10) * 10;
			}
		}
		requestAnimationFrame(countFrames);

		var shadowDOM = document.createElement('custom-canvas');
		shadowDOM.style = 'position: fixed; left: 0; top: 0; width: 0; height: 0; opacity: 0; user-select: none; pointer-events: none; z-index: -1;';
		this.#shadowRoot = shadowDOM.attachShadow({
			mode: 'open'
		});
		document.body.appendChild(shadowDOM);

		// new ResizeObserver(() => {
		// 	this.clean();
		// 	this.#render();
		// }).observe(this.#canvas);
	}

	get stream() {
		if (!this.#stream) {
			this.#stream = this.#canvas.captureStream(0);
			this.#stream.getVideoTracks().forEach(track => track.contentHint = this.#contentHint);
		}

		return this.#stream;
	}

	get objects() {
		return this.#objects;
	}

	get contextAttributes() {
		return this.#ctx.getContextAttributes();
	}

	find(key) {
		return this.#objects[key];
	}

	undo(delta = 1) {
		var keys = Object.keys(this.#objects);
		delta = Math.min(keys.length, Math.abs(delta));
		keys = keys.splice(-delta, delta);

		var intersectedKeys = this.#cascadeIntersectionSearch(keys.slice());

		intersectedKeys.forEach(i => {
			var border = this.#objects[i].settings?.lineWidth ?? 0;
			this.#ctx.clearRect(
				Math.floor(this.#objects[i].AABB.x - border),
				Math.floor(this.#objects[i].AABB.y - border),
				Math.ceil(this.#objects[i].AABB.width + border * 2),
				Math.ceil(this.#objects[i].AABB.height + border * 2)
			);
		});

		keys.forEach(i => {
			this.#undone[i] = this.#objects[i];
			delete this.#objects[i];
		});

		this.#render(intersectedKeys.filter(i => !keys.includes(i)));

		if (keys.some(i => this.#undone[i].type == 'media')) {
			this.#reLoop();
		}

		this.#requestFrame();
	}

	redo(delta = 1) {
		var keys = Object.keys(this.#undone);
		delta = Math.min(keys.length, Math.abs(delta));
		var keys = keys.splice(-delta, delta);
		
		keys.forEach(key => {
			this.#objects[key] = this.#undone[key];
			delete this.#undone[key];
		});

		this.#render(keys);

		if (keys.some(i => this.#objects[i].type == 'media')) {
			this.#reLoop();
		}

		this.#requestFrame();
	}

	takePhoto (type = 'image/png', encoderOptions = 0.92) {
		return this.#canvas.toDataURL(type, encoderOptions);
	}

	// clean(x = 0, y = 0, width = this.#canvas.clientWidth, height = this.#canvas.clientHeight) {
	//  this.#objects = {};
	// 	this.#ctx.clearRect(x, y, width, height);
	// 	this.#requestFrame();
	// }

	reset() {
		this.#objects = {};
		this.reset();
		this.#requestFrame();
	}

	line({
		x,
		y
	}, {
		alpha = 1,
		fill = false,
		fillRule = 'nonzero',
		fillStyle  = '#000000',
		dash = [],
		dashOffset = 0,
		lineCap = 'round',
		lineJoin = 'round',
		lineWidth = 3,
		miterLimit = 2,
		strokeStyle = '#000000',
		shadowColor = '#000000',
		shadowBlur = 0,
		shadowOffsetX = 0,
		shadowOffsetY = 0,
		globalCompositeOperation = 'source-over',
		SplineSegmentSize = 2
	} = {}) {
		this.#undone = [];

		var lastPoints = [
			{
				x,
				y
			}
		];
		var AABB = {
			x,
			y,
			width: lineWidth,
			height: lineWidth
		};

		var settings = {
			alpha,
			fill,
			fillRule,
			fillStyle,
			dash,
			dashOffset,
			lineCap,
			lineJoin,
			lineWidth,
			miterLimit,
			strokeStyle,
			shadowColor,
			shadowBlur,
			shadowOffsetX,
			shadowOffsetY,
			globalCompositeOperation,
			SplineSegmentSize
		};

		var path = new Path2D();
		path.moveTo(lastPoints[0].x, lastPoints[0].y);

		var key = Date.now();
		this.#objects[key] = {
			type: 'line',
			lastPoints,
			path,
			AABB,
			settings,
			transformation: {}
		};

		return {
			key,
			point: async (x, y, SplineSegmentSize = settings.SplineSegmentSize) => {
				var point = {
					x,
					y
				};

				if (SplineSegmentSize < 1) {
					SplineSegmentSize = 1;
				}

				if (this.#euclideanDistance(this.#objects[key].lastPoints.at(-1), point) >= SplineSegmentSize) {
					this.#objects[key].AABB = this.#updateAABB(this.#objects[key].AABB, point);

					this.#objects[key].lastPoints.push(point);

					var size = this.#objects[key].lastPoints.length;

					if (size >= 4) {
						var points = {
							P0: this.#objects[key].lastPoints[size - 4],
							P1: this.#objects[key].lastPoints[size - 3],
							P2: this.#objects[key].lastPoints[size - 2],
							P3: this.#objects[key].lastPoints[size - 1]
						};

						var iterations = Math.ceil(this.#euclideanDistance(points.P1, points.P2) / SplineSegmentSize);
						var increment = 1 / iterations;

						var path = new Path2D();

						for (let i = 0; i <= iterations; i++) {
							var point = this.#catmullRomSpline(points, i * increment);

							this.#objects[key].path.lineTo(point.x, point.y);

							if (i == 0) {
								path.moveTo(point.x, point.y);
							} else {
								path.lineTo(point.x, point.y);
							}
						}

						this.#drawLine(key, path);

						this.#requestFrame();
					}
				}
			},
			translate: (x = 0, y = 0) => {
				this.#reRender([key], () => {
					this.#objects[key].transformation['translate'] = {
						x,
						y
					};
				});
			},
			scale: (x = 1, y = 1) => {
				this.#reRender([key], () => {
					this.#objects[key].transformation['scale'] = {
						x,
						y
					};
				});
			},
			rotate: (angle = 0) => {
				this.#reRender([key], () => {
					this.#objects[key].transformation['rotate'] = angle;
				});
			},
			transform: (...props) => {
				this.#reRender([key], () => {
					this.#objects[key].transformation['transform'] = [...props];
				});
			},
			clip: (fillRule) => {
				this.#reRender([key], () => {
					this.#objects[key].transformation['clip'] = fillRule;
				});
			},
			setting: ({
				alpha = this.#objects[key].settings.alpha,
				fill = this.#objects[key].settings.fill,
				fillRule = this.#objects[key].settings.fillRule,
				fillStyle = this.#objects[key].settings.fillStyle,
				dash = this.#objects[key].settings.dash,
				dashOffset = this.#objects[key].settings.dashOffset,
				lineCap = this.#objects[key].settings.lineCap,
				lineJoin = this.#objects[key].settings.lineJoin,
				lineWidth = this.#objects[key].settings.lineWidth,
				miterLimit = this.#objects[key].settings.miterLimit,
				strokeStyle = this.#objects[key].settings.strokeStyle,
				shadowColor = this.#objects[key].settings.shadowColor,
				shadowBlur = this.#objects[key].settings.shadowBlur,
				shadowOffsetX = this.#objects[key].settings.shadowOffsetX,
				shadowOffsetY = this.#objects[key].settings.shadowOffsetY,
				globalCompositeOperation = this.#objects[key].settings.globalCompositeOperation,
				SplineSegmentSize = this.#objects[key].settings.SplineSegmentSize
			}	= {}) => {
				this.#reRender([key], () => {
					this.#objects[key].settings = {
						alpha,
						fill,
						fillRule,
						fillStyle,
						dash,
						dashOffset,
						lineCap,
						lineJoin,
						lineWidth,
						miterLimit,
						strokeStyle,
						shadowColor,
						shadowBlur,
						shadowOffsetX,
						shadowOffsetY,
						globalCompositeOperation,
						SplineSegmentSize
					};
				});
			}
		}
	}

	rectangle({
		x,
		y,
		width,
		height
	}, {
		alpha = 1.0,
		fill = false,
		fillRule = 'nonzero',
		fillStyle  = '#000000',
		dash = [],
		dashOffset = 0,
		lineCap = 'round',
		lineJoin = 'round',
		lineWidth = 3,
		miterLimit = 2,
		strokeStyle = '#000000',
		direction = 'ltr',
		shadowColor = '#000000',
		shadowBlur = 0,
		shadowOffsetX = 0,
		shadowOffsetY = 0,
		globalCompositeOperation = 'source-over',
		radii = 0
	} = {}) {
		this.#undone = [];

		var position = {
			x: parseInt(x),
			y: parseInt(y)
		};
		var size = {
			width: parseInt(width ?? lineWidth * 2),
			height: parseInt(height ?? lineWidth * 2)
		};
		var AABB = { ...position, ...size };

		var settings = {
			alpha,
			fill,
			fillRule,
			fillStyle,
			dash,
			dashOffset,
			lineCap,
			lineJoin,
			lineWidth,
			miterLimit,
			strokeStyle,
			direction,
			shadowColor,
			shadowBlur,
			shadowOffsetX,
			shadowOffsetY,
			globalCompositeOperation,
			radii
		};

		var key = Date.now();
		this.#objects[key] = {
			type: 'rectangle',
			position,
			size,
			AABB,
			settings,
			transformation: {}
		};

		this.#drawRectangle(key);
		this.#requestFrame();

		return {
			key,
			rePosition: (x, y) => {	
				this.#reRender([key], () => {
					this.#objects[key].position.x = parseInt(x);
					this.#objects[key].position.y = parseInt(y);

					this.#objects[key].AABB = this.#updateAABB(this.#objects[key].AABB, this.#objects[key].position);
				});
			},
			reSize: (width, height) => {
				this.#reRender([key], () => {
					this.#objects[key].size.width = parseInt(width);
					this.#objects[key].size.height = parseInt(height);

					this.#objects[key].AABB = this.#updateAABB(this.#objects[key].AABB, {
						x: this.#objects[key].position.x + this.#objects[key].size.width,
						y: this.#objects[key].position.y + this.#objects[key].size.height
					});
				});
			},
			translate: (x = 0, y = 0) => {
				this.#reRender([key], () => {
					this.#objects[key].transformation['translate'] = {
						x,
						y
					};
				});
			},
			scale: (x = 1, y = 1) => {
				this.#reRender([key], () => {
					this.#objects[key].transformation['scale'] = {
						x,
						y
					};
				});
			},
			rotate: (angle = 0) => {
				this.#reRender([key], () => {
					this.#objects[key].transformation['rotate'] = angle;
				});
			},
			transform: (...props) => {
				this.#reRender([key], () => {
					this.#objects[key].transformation['transform'] = [...props];
				});
			},
			clip: (fillRule) => {
				this.#reRender([key], () => {
					this.#objects[key].transformation['clip'] = fillRule;
				});
			},
			setting: ({
				alpha = this.#objects[key].settings.alpha,
				fill = this.#objects[key].settings.fill,
				fillRule = this.#objects[key].settings.fillRule,
				fillStyle = this.#objects[key].settings.fillStyle,
				dash = this.#objects[key].settings.dash,
				dashOffset = this.#objects[key].settings.dashOffset,
				lineCap = this.#objects[key].settings.lineCap,
				lineJoin = this.#objects[key].settings.lineJoin,
				lineWidth = this.#objects[key].settings.lineWidth,
				miterLimit = this.#objects[key].settings.miterLimit,
				strokeStyle = this.#objects[key].settings.strokeStyle,
				direction = this.#objects[key].settings.direction,
				shadowColor = this.#objects[key].settings.shadowColor,
				shadowBlur = this.#objects[key].settings.shadowBlur,
				shadowOffsetX = this.#objects[key].settings.shadowOffsetX,
				shadowOffsetY = this.#objects[key].settings.shadowOffsetY,
				globalCompositeOperation = this.#objects[key].settings.globalCompositeOperation,
				radii = this.#objects[key].settings.radii
			}) => {
				this.#reRender([key], () => {
					this.#objects[key].settings = {
						alpha,
						fill,
						fillRule,
						fillStyle,
						dash,
						dashOffset,
						lineCap,
						lineJoin,
						lineWidth,
						miterLimit,
						strokeStyle,
						direction,
						shadowColor,
						shadowBlur,
						shadowOffsetX,
						shadowOffsetY,
						globalCompositeOperation,
						radii
					};
				});
			}
		}
	}

	ellipse({
		x,
		y,
		width,
		height
	}, {
		alpha = 1.0,
		fill = false,
		fillRule = 'nonzero',
		fillStyle  = '#000000',
		dash = [],
		dashOffset = 0,
		lineCap = 'round',
		lineJoin = 'round',
		lineWidth = 3,
		miterLimit = 2,
		strokeStyle = '#000000',
		direction = 'ltr',
		shadowColor = '#000000',
		shadowBlur = 0,
		shadowOffsetX = 0,
		shadowOffsetY = 0,
		globalCompositeOperation = 'source-over',
		rotation = 0,
		startAngle = 0,
		endAngle = 2 * Math.PI,
		counterclockwise = false,
	} = {}) {
		this.#undone = [];

		var position = {
			x: parseInt(x),
			y: parseInt(y)
		};
		var size = {
			width: parseInt(width ?? lineWidth * 2),
			height: parseInt(height ?? lineWidth * 2)
		};
		var AABB = { ...position, ...size };

		var settings = {
			alpha,
			fill,
			fillRule,
			fillStyle,
			dash,
			dashOffset,
			lineCap,
			lineJoin,
			lineWidth,
			miterLimit,
			strokeStyle,
			direction,
			shadowColor,
			shadowBlur,
			shadowOffsetX,
			shadowOffsetY,
			globalCompositeOperation,
			rotation,
			startAngle,
			endAngle,
			counterclockwise
		};

		var key = Date.now();
		this.#objects[key] = {
			type: 'ellipse',
			position,
			size,
			AABB,
			settings,
			transformation: {}
		};

		this.#drawEllipse(key);
		this.#requestFrame();

		return {
			key,
			rePosition: (x, y) => {	
				this.#reRender([key], () => {
					this.#objects[key].position.x = parseInt(x);
					this.#objects[key].position.y = parseInt(y);

					this.#objects[key].AABB = this.#updateAABB(this.#objects[key].AABB, this.#objects[key].position);
				});
			},
			reSize: (width, height) => {
				this.#reRender([key], () => {
					this.#objects[key].size.width = parseInt(width);
					this.#objects[key].size.height = parseInt(height);

					this.#objects[key].AABB = this.#updateAABB(this.#objects[key].AABB, {
						x: this.#objects[key].position.x + this.#objects[key].size.width,
						y: this.#objects[key].position.y + this.#objects[key].size.height
					});
				});
			},
			translate: (x = 0, y = 0) => {
				this.#reRender([key], () => {
					this.#objects[key].transformation['translate'] = {
						x,
						y
					};
				});
			},
			scale: (x = 1, y = 1) => {
				this.#reRender([key], () => {
					this.#objects[key].transformation['scale'] = {
						x,
						y
					};
				});
			},
			rotate: (angle = 0) => {
				this.#reRender([key], () => {
					this.#objects[key].transformation['rotate'] = angle;
				});
			},
			transform: (...props) => {
				this.#reRender([key], () => {
					this.#objects[key].transformation['transform'] = [...props];
				});
			},
			clip: (fillRule) => {
				this.#reRender([key], () => {
					this.#objects[key].transformation['clip'] = fillRule;
				});
			},
			setting: ({
				alpha = this.#objects[key].settings.alpha,
				fill = this.#objects[key].settings.fill,
				fillRule = this.#objects[key].settings.fillRule,
				fillStyle = this.#objects[key].settings.fillStyle,
				dash = this.#objects[key].settings.dash,
				dashOffset = this.#objects[key].settings.dashOffset,
				lineCap = this.#objects[key].settings.lineCap,
				lineJoin = this.#objects[key].settings.lineJoin,
				lineWidth = this.#objects[key].settings.lineWidth,
				miterLimit = this.#objects[key].settings.miterLimit,
				strokeStyle = this.#objects[key].settings.strokeStyle,
				direction = this.#objects[key].settings.direction,
				shadowColor = this.#objects[key].settings.shadowColor,
				shadowBlur = this.#objects[key].settings.shadowBlur,
				shadowOffsetX = this.#objects[key].settings.shadowOffsetX,
				shadowOffsetY = this.#objects[key].settings.shadowOffsetY,
				globalCompositeOperation = this.#objects[key].settings.globalCompositeOperation,
				rotation = this.#objects[key].settings.rotation,
				startAngle = this.#objects[key].settings.startAngle,
				endAngle = this.#objects[key].settings.endAngle,
				counterclockwise = this.#objects[key].settings.counterclockwise
			}) => {
				this.#reRender([key], () => {
					this.#objects[key].settings = {
						alpha,
						fill,
						fillRule,
						fillStyle,
						dash,
						dashOffset,
						lineCap,
						lineJoin,
						lineWidth,
						miterLimit,
						strokeStyle,
						direction,
						shadowColor,
						shadowBlur,
						shadowOffsetX,
						shadowOffsetY,
						globalCompositeOperation,
						rotation,
						startAngle,
						endAngle,
						counterclockwise
					};
				});
			}
		}
	}

	async media(media, {
		x,
		y,
		width,
		height
	}, {
		alpha = 1,
		dash = [],
		dashOffset = 0,
		lineCap = 'round',
		lineJoin = 'round',
		lineWidth = 0,
		miterLimit = 2,
		strokeStyle = '#000000',
		direction = 'ltr',
		shadowColor = '#000000',
		shadowBlur = 0,
		shadowOffsetX = 0,
		shadowOffsetY = 0,
		globalCompositeOperation = 'source-over',
		radii = 0,
		zoom = 1,
		imageSmoothingEnabled = this.#ctx.imageSmoothingEnabled,
		imageSmoothingQuality = this.#ctx.imageSmoothingQuality,
		contentHint = this.#contentHint
	} = {}) {
		this.#undone = [];

		if (radii < 0) radii = 0
		if (zoom < 1) zoom = 1

		var getSize = (media, {
			width,
			height
		}) => {
			var size = {};

			var { width: w, height: h } = this.#getSizeElement(media);

			if (width && height) {
				size.width = parseInt(width);
				size.height = parseInt(height);
			} else if (width) {
				size.width = parseInt(width);
				size.height = Math.round(parseInt(width) * (h / w));
			} else if (height) {
				size.width = Math.round(parseInt(height) * (w / h));
				size.height = parseInt(height);
			} else {
				size.width = parseInt(w);
				size.height = parseInt(h);
			}

			return size;
		};

		var position = {
			x: parseInt(x),
			y: parseInt(y)
		};
		var size = getSize(media, {
			width,
			height
		});
		var AABB = { ...position, ...size }

		var settings = {
			alpha,
			dash,
			dashOffset,
			lineCap,
			lineJoin,
			lineWidth,
			miterLimit,
			strokeStyle,
			direction,
			shadowColor,
			shadowBlur,
			shadowOffsetX,
			shadowOffsetY,
			globalCompositeOperation,
			radii,
			zoom,
			imageSmoothingEnabled,
			imageSmoothingQuality
		};

		var key = Date.now();
		this.#objects[key] = {
			type: 'media',
			media,
			position,
			size,
			originalSize: this.#getSizeElement(media),
			AABB,
			settings,
			transformation: {}
		};

		if ('captureStream' in media) {
			let getFPS = () => {
				var stream = media.captureStream(0);
				var videoTracks = stream?.getVideoTracks();

				if (videoTracks) {
					return [...new Set(videoTracks.filter(track => track.enabled && track.readyState == 'live').map(track => track.getSettings()?.frameRate).filter(rate => rate))];
				}

				return undefined;
			};

			if (
				!(media instanceof HTMLVideoElement) ||
				!media.paused
			) {
				var FPS = getFPS();

				if (FPS.length) {
					this.#objects[key].FPS = FPS;
				}
			}

			if (media instanceof HTMLVideoElement) {
				this.#shadowRoot.appendChild(media);

				media.addEventListener('play', () => {
					if (key in this.#objects) {
						var FPS = getFPS();

						if (FPS.length) {
							if (key in this.#objects) {
								this.#objects[key].FPS = FPS;
								this.#reLoop();
							} else if (key in this.#undone) {
								this.#undone[key].FPS = FPS;
							}
						}
					}
				});

				media.addEventListener('pause', () => {
					if (key in this.#objects) {
						delete this.#objects[key].FPS;
						this.#reLoop();
					} else if (key in this.#undone) {
						delete this.#undone[key].FPS;
					}
				});

				media.addEventListener('ended', () => {
					if (key in this.#objects && !media.loop) {
						delete this.#objects[key].FPS;
						this.#reLoop();
					} else if (key in this.#undone && !media.loop) {
						delete this.#undone[key].FPS;
					}
				});
			}
		} else if (
			media instanceof HTMLImageElement ||
			media instanceof SVGImageElement
		) {
			var res = await fetch(media.src)
			// var mediaType = res.then(response => response.blob()).then(blob => blob.type);
			var mediaType = res.headers.get('content-type');

			if (
				mediaType.toLowerCase() == 'image/gif' &&
				'ImageDecoder' in window
			) {
				var imageDecoder = new ImageDecoder({
					data: res.body,
					type: 'image/gif'
				});

				await Promise.all([imageDecoder.completed, imageDecoder.tracks.ready])

				var tracks = Object.values(imageDecoder.tracks).filter(track => track.animated)

				var images = await Promise.all(tracks.map(track => Promise.all([...Array(track.frameCount).keys()].map(async frameIndex => imageDecoder.decode({
					frameIndex,
					completeFramesOnly: true
				})))));

				this.#objects[key].FPS = [...new Set(tracks.map((track, i) => 1000 * track.frameCount / images[i].reduce((acc, cur) => acc + cur.image.duration / 1000, 0)))];

				var loop = async (frameIndex = 0, repetitionCount = 1) => {
					var startTime = performance.now();
					var image = images[imageDecoder.tracks.selectedIndex][frameIndex].image;

					if (repetitionCount > imageDecoder.tracks.selectedTrack.repetitionCount) {
						delete this.#objects[key].FPS;
						imageDecoder.close();
						return this.#reLoop();
					} else if (key in this.#objects) {
						this.#objects[key].media = image;

						if (frameIndex == imageDecoder.tracks.selectedTrack.frameCount - 1) {
							repetitionCount++;
						}

						frameIndex++;
					} else if (!(key in this.#undone)) {
						return imageDecoder.close();
					}

					var delay = performance.now() - startTime;
					setTimeout(() => loop(
						frameIndex % imageDecoder.tracks.selectedTrack.frameCount,
						repetitionCount % Number.MAX_SAFE_INTEGER
					), Math.max(0, Math.round((image.duration / 1000) - delay)));
				};

				if (this.#objects[key].FPS.length) {
					loop();
				}
			} else if (mediaType.toLowerCase() == 'image/svg+xml') {
				var svg = await res.text();

				var SVGAnimateProperties = this.#SVGAnimateProperties(svg);

				if (SVGAnimateProperties) {
					this.#shadowRoot.appendChild(media);

					this.#objects[key].FPS = [this.#animate.windowFPS];

					if (SVGAnimateProperties.iterations != Infinity) {
						setTimeout(() => {
							if (key in this.#objects) {
								delete this.#objects[key].FPS;
								this.#reLoop();
							} else if (key in this.#undone) {
								delete this.#undone[key].FPS;						
								this.#reLoop();
							}
						}, SVGAnimateProperties.duration * SVGAnimateProperties.iterations);
					}
				}
			}
		} 

		if ('requestVideoFrameCallback' in media) {
			media.requestVideoFrameCallback(() => {
				console.log('oi');
			});
		}

		this.#reLoop();

		return {
			key,
			rePosition: (x, y) => {	
				this.#reRender([key], () => {
					this.#objects[key].position.x = parseInt(x);
					this.#objects[key].position.y = parseInt(y);

					this.#objects[key].AABB = this.#updateAABB(this.#objects[key].AABB, this.#objects[key].position);
				});
			},
			reSize: (width, height) => {
				this.#reRender([key], () => {
					this.#objects[key].size.width = parseInt(width);
					this.#objects[key].size.height = parseInt(height);

					this.#objects[key].AABB = this.#updateAABB(this.#objects[key].AABB, {
						x: this.#objects[key].position.x + this.#objects[key].size.width,
						y: this.#objects[key].position.y + this.#objects[key].size.height
					});
				});
			},
			translate: (x = 0, y = 0) => {
				this.#reRender([key], () => {
					this.#objects[key].transformation['translate'] = {
						x,
						y
					};
				});
			},
			scale: (x = 1, y = 1) => {
				this.#reRender([key], () => {
					this.#objects[key].transformation['scale'] = {
						x,
						y
					};
				});
			},
			rotate: (angle = 0) => {
				this.#reRender([key], () => {
					this.#objects[key].transformation['rotate'] = angle;
				});
			},
			transform: (...props) => {
				this.#reRender([key], () => {
					this.#objects[key].transformation['transform'] = [...props];
				});
			},
			clip: (fillRule) => {
				this.#reRender([key], () => {
					this.#objects[key].transformation['clip'] = fillRule;
				});
			},
			setting: ({
				alpha = this.#objects[key].settings.alpha,
				dash = this.#objects[key].settings.dash,
				dashOffset = this.#objects[key].settings.dashOffset,
				lineCap = this.#objects[key].settings.lineCap,
				lineJoin = this.#objects[key].settings.lineJoin,
				lineWidth = this.#objects[key].settings.lineWidth,
				miterLimit = this.#objects[key].settings.miterLimit,
				strokeStyle = this.#objects[key].settings.strokeStyle,
				direction = this.#objects[key].settings.direction,
				shadowColor = this.#objects[key].settings.shadowColor,
				shadowBlur = this.#objects[key].settings.shadowBlur,
				shadowOffsetX = this.#objects[key].settings.shadowOffsetX,
				shadowOffsetY = this.#objects[key].settings.shadowOffsetY,
				globalCompositeOperation = this.#objects[key].settings.globalCompositeOperation,
				radii = this.#objects[key].settings.radii,
				zoom = this.#objects[key].settings.zoom,
				imageSmoothingEnabled = this.#objects[key].settings.imageSmoothingEnabled,
				imageSmoothingQuality = this.#objects[key].settings.imageSmoothingQuality
			}) => {
				this.#reRender([key], () => {
					this.#objects[key].settings = {
						alpha,
						dash,
						dashOffset,
						lineCap,
						lineJoin,
						lineWidth,
						miterLimit,
						strokeStyle,
						direction,
						shadowColor,
						shadowBlur,
						shadowOffsetX,
						shadowOffsetY,
						globalCompositeOperation,
						radii,
						zoom,
						imageSmoothingEnabled,
						imageSmoothingQuality
					};
				});
			}
		}
	}

	text(text, {
		x,
		y
	}, {
		alpha = 1,
		fill = false,
		// fillRule = 'nonzero',
		fillStyle  = '#000000',
		dash = [],
		dashOffset = 0,
		lineCap = 'round',
		lineJoin = 'round',
		lineWidth = 1,
		miterLimit = 2,
		strokeStyle = '#000000',
		direction = 'ltr',
		shadowColor = '#000000',
		shadowBlur = 0,
		shadowOffsetX = 0,
		shadowOffsetY = 0,
		globalCompositeOperation = 'source-over',
		font = '10px sans-serif',
		fontKerning = 'auto',
		fontStretch = 'normal',
		fontVariantCaps = 'normal',
		textAlign = 'start',
		textBaseline = 'alphabetic',
		textRendering = 'auto',
		wordSpacing = '0px'
	} = {}) { // https://developer.mozilla.org/en-US/docs/Web/API/TexttextMetrics
		this.#undone = [];

		var position = {
			x: parseInt(x),
			y: parseInt(y)
		};
		var size = {
			width: lineWidth,
			height: lineWidth
		};
		var AABB = { ...position, ...size };

		var settings = {
			alpha,
			fill,
			// fillRule,
			fillStyle,
			dash,
			dashOffset,
			lineCap,
			lineJoin,
			lineWidth,
			miterLimit,
			strokeStyle,
			direction,
			shadowColor,
			shadowBlur,
			shadowOffsetX,
			shadowOffsetY,
			globalCompositeOperation,
			font,
			fontKerning,
			fontStretch,
			fontVariantCaps,
			textAlign,
			textBaseline,
			textRendering,
			wordSpacing
		};

		var key = Date.now();
		this.#objects[key] = {
			type: 'text',
			text,
			position,
			size,
			AABB,
			settings,
			transformation: {}
		};

		var getTextSize = object => {
			this.#ctx.save();
			this.#ctx.font = object.settings.font;
			this.#ctx.fontKerning = object.settings.fontKerning;
			this.#ctx.fontStretch = object.settings.fontStretch;
			this.#ctx.fontVariantCaps = object.settings.fontVariantCaps;
			this.#ctx.wordSpacing = object.settings.wordSpacing;
			if (object.transformation.scale) this.#ctx.scale(object.transformation.scale.x, object.transformation.scale.y);
	
			var textMetrics = this.#ctx.measureText(object.text);
			var height = Math.ceil(textMetrics.actualBoundingBoxAscent + textMetrics.actualBoundingBoxDescent);
			var width = Math.ceil(textMetrics.width);
			this.#ctx.restore();

			return {
				width,
				height
			}
		};

		var size = getTextSize(this.#objects[key]);

		this.#objects[key].size = size;
		this.#objects[key].AABB.width = size.width;
		this.#objects[key].AABB.height = size.height;

		this.#drawText(key);
		this.#requestFrame();

		return {
			key,
			write: text => {
				this.#objects[key].text = text;

				this.#reRender([key], () => {
					var size = getTextSize(this.#objects[key]);

					this.#objects[key].size = size;
					this.#objects[key].AABB.width = size.width;
					this.#objects[key].AABB.height = size.height;
				});
			},
			rePosition: (x, y) => {
				this.#reRender([key], () => {
					this.#objects[key].AABB.x = this.#objects[key].position.x = parseInt(x);
					this.#objects[key].AABB.y = this.#objects[key].position.y = parseInt(y);
				});
			},
			translate: (x = 0, y = 0) => {
				this.#reRender([key], () => {
					this.#objects[key].transformation['translate'] = {
						x,
						y
					};
				});
			},
			scale: (x = 1, y = 1) => {
				this.#reRender([key], () => {
					this.#objects[key].transformation['scale'] = {
						x,
						y
					};
				});
			},
			rotate: (angle = 0) => {
				this.#reRender([key], () => {
					this.#objects[key].transformation['rotate'] = angle;
				});
			},
			transform: (...props) => {
				this.#reRender([key], () => {
					this.#objects[key].transformation['transform'] = [...props];
				});
			},
			clip: (fillRule) => {
				this.#reRender([key], () => {
					this.#objects[key].transformation['clip'] = fillRule;
				});
			},
			setting: ({
				alpha = this.#objects[key].settings.alpha,
				fill = this.#objects[key].settings.fill,
				// fillRule = this.#objects[key].settings.fillRule,
				fillStyle = this.#objects[key].settings.fillStyle,
				dash = this.#objects[key].settings.dash,
				dashOffset = this.#objects[key].settings.dashOffset,
				lineCap = this.#objects[key].settings.lineCap,
				lineJoin = this.#objects[key].settings.lineJoin,
				lineWidth = this.#objects[key].settings.lineWidth,
				miterLimit = this.#objects[key].settings.miterLimit,
				strokeStyle = this.#objects[key].settings.strokeStyle,
				direction = this.#objects[key].settings.direction,
				shadowColor = this.#objects[key].settings.shadowColor,
				shadowBlur = this.#objects[key].settings.shadowBlur,
				shadowOffsetX = this.#objects[key].settings.shadowOffsetX,
				shadowOffsetY = this.#objects[key].settings.shadowOffsetY,
				globalCompositeOperation = this.#objects[key].settings.globalCompositeOperation,
				font = this.#objects[key].settings.font,
				fontKerning = this.#objects[key].settings.fontKerning,
				fontStretch = this.#objects[key].settings.fontStretch,
				fontVariantCaps = this.#objects[key].settings.fontVariantCaps,
				textAlign = this.#objects[key].settings.textAlign,
				textBaseline = this.#objects[key].settings.textBaseline,
				textRendering = this.#objects[key].settings.textRendering,
				wordSpacing = this.#objects[key].settings.wordSpacing
			}) => {
				this.#reRender([key], () => {
					this.#objects[key].settings = {
						alpha,
						fill,
						// fillRule,
						fillStyle,
						dash,
						dashOffset,
						lineCap,
						lineJoin,
						lineWidth,
						miterLimit,
						strokeStyle,
						direction,
						shadowColor,
						shadowBlur,
						shadowOffsetX,
						shadowOffsetY,
						globalCompositeOperation,
						font,
						fontKerning,
						fontStretch,
						fontVariantCaps,
						textAlign,
						textBaseline,
						textRendering,
						wordSpacing
					};
				});
			}
		}
	}

	eraser({
		x,
		y,
		width = 50,
		height = 50
	}) {
		this.#undone = [];

		var position = {
			x: parseInt(x - width / 2),
			y: parseInt(y - height / 2)
		};
		var size = {
			width: parseInt(width),
			height: parseInt(height)
		};
		var AABB = { ...position, ...size };

		var key = Date.now();
		this.#objects[key] = {
			type: 'eraser',
			positions: [position],
			size,
			AABB
		};

		this.#drawEraser(key);
		this.#requestFrame();

		return {
			key,
			point: async (x, y, minDistance = 1) => {
				var position = {
					x: parseInt(x - size.width / 2),
					y: parseInt(y - size.height / 2)
				};
				var previousPosition = this.#objects[key].positions.at(-1);

				if (this.#euclideanDistance({
					x: parseInt(previousPosition.x + size.width / 2),
					y: parseInt(previousPosition.y + size.height / 2)
				}, {
					x: parseInt(x),
					y: parseInt(y)
				}) > minDistance) {
					this.#objects[key].AABB = this.#updateAABB(this.#objects[key].AABB, {
						x: position.x,
						y: position.y,
					});
					this.#objects[key].AABB = this.#updateAABB(this.#objects[key].AABB, {
						x: position.x + size.width,
						y: position.y + size.height,
					});

					this.#objects[key].positions.push(position);

					this.#drawEraser(key, position);

					this.#requestFrame();
				}
			}
		};
	}

	/*magicEraser({
		x,
		y,
		width = 10,
		height = 10
	}) {
		this.#undone = [];

		var position = {
			x: parseInt(x - width / 2),
			y: parseInt(y - height / 2)
		};
		var size = {
			width: parseInt(width),
			height: parseInt(height)
		};
		var AABB = { ...position, ...size };

		for (var key of Object.keys(this.#objects).reverse()) {

			if (this.#intersectionBetweenAABB(AABB, this.#objects[key].AABB)) {
				this.#reRender([key], () => {
					this.#undone[key] = this.#objects[key];
					delete this.#objects[key];
				});

				break;
			}

		}

	}*/

	#drawBackground() {}
	#drawLine(key, path = null) {
		var object = this.#objects[key]

		this.#ctx.save();
		if (object.settings.lineWidth > 0) {
			this.#ctx.setLineDash(object.settings.dash);
			this.#ctx.lineDashOffset = object.settings.dashOffset;
			this.#ctx.lineCap = object.settings.lineCap;
			this.#ctx.lineJoin = object.settings.lineJoin;
			this.#ctx.lineWidth = object.settings.lineWidth;
			this.#ctx.miterLimit = object.settings.miterLimit;
			this.#ctx.strokeStyle = object.settings.strokeStyle;
		}
		if (
			object.settings.shadowBlur > 0 ||
			object.settings.shadowOffsetX != 0 ||
			object.settings.shadowOffsetY != 0
		) {
			this.#ctx.shadowColor = object.settings.shadowColor;
			this.#ctx.shadowBlur = object.settings.shadowBlur;
			this.#ctx.shadowOffsetX = object.settings.shadowOffsetX;
			this.#ctx.shadowOffsetY = object.settings.shadowOffsetY;
		}
		this.#ctx.globalAlpha = object.settings.alpha;
		this.#ctx.direction = object.settings.direction;
		this.#ctx.globalCompositeOperation = object.settings.globalCompositeOperation;

		Object.keys(object.transformation).forEach(key => {
			if (key == 'translate') this.#ctx.translate(this.#objects[key].transformation[key].x, this.#objects[key].transformation[key].y);
			if (key == 'scale') this.#ctx.scale(this.#objects[key].transformation[key].x, this.#objects[key].transformation[key].y);
			if (key == 'rotate') this.#ctx.rotate(this.#objects[key].transformation[key]);
			if (key == 'setTransform') this.#ctx.setTransform(...this.#objects[key].transformation[key]);
		});

		if (object.settings.fill) {
			this.#ctx.fillStyle = object.settings.fillStyle;
			this.#ctx.fill(path ? path : object.path, object.settings.fillRule);
		}

		if (object.settings.lineWidth > 0 || !object.settings.fill) {
			this.#ctx.stroke(path ? path : object.path);
		}

		if ('clip' in object.transformation) {
			this.#ctx.clip(object.transformation['clip']);
		}

		this.#ctx.restore();
	}

	#drawRectangle(key) {
		var object = this.#objects[key]

		this.#ctx.save();
		this.#ctx.beginPath();
		if (object.settings.lineWidth > 0) {
			this.#ctx.setLineDash(object.settings.dash);
			this.#ctx.lineDashOffset = object.settings.dashOffset;
			this.#ctx.lineCap = object.settings.lineCap;
			this.#ctx.lineJoin = object.settings.lineJoin;
			this.#ctx.lineWidth = object.settings.lineWidth;
			this.#ctx.miterLimit = object.settings.miterLimit;
			this.#ctx.strokeStyle = object.settings.strokeStyle;
		}
		if (
			object.settings.shadowBlur > 0 ||
			object.settings.shadowOffsetX != 0 ||
			object.settings.shadowOffsetY != 0
		) {
			this.#ctx.shadowColor = object.settings.shadowColor;
			this.#ctx.shadowBlur = object.settings.shadowBlur;
			this.#ctx.shadowOffsetX = object.settings.shadowOffsetX;
			this.#ctx.shadowOffsetY = object.settings.shadowOffsetY;
		}
		this.#ctx.globalAlpha = object.settings.alpha;
		this.#ctx.direction = object.settings.direction;
		this.#ctx.globalCompositeOperation = object.settings.globalCompositeOperation;

		Object.keys(object.transformation).forEach(key => {
			if (key == 'translate') this.#ctx.translate(object.transformation[key].x, object.transformation[key].y);
			if (key == 'scale') this.#ctx.scale(object.transformation[key].x, object.transformation[key].y);
			if (key == 'rotate') this.#ctx.rotate(object.transformation[key]);
			if (key == 'setTransform') this.#ctx.setTransform(...object.transformation[key]);
		});

		this.#ctx.roundRect(
			object.position.x + object.settings.lineWidth / 2,
			object.position.y + object.settings.lineWidth / 2,
			object.size.width - object.settings.lineWidth,
			object.size.height - object.settings.lineWidth,
			object.settings.radii
		);

		if (object.settings.fill) {
			this.#ctx.fillStyle = object.settings.fillStyle;
			this.#ctx.fill(object.settings.fillRule);
		}

		if (object.settings.lineWidth > 0 || !object.settings.fill) {
			this.#ctx.stroke();
		}

		if ('clip' in object.transformation) {
			this.#ctx.clip(object.transformation['clip']);
		}

		this.#ctx.restore();
	}

	#drawEllipse(key) {
		var object = this.#objects[key]

		this.#ctx.save();
		this.#ctx.beginPath();
		if (object.settings.lineWidth > 0) {
			this.#ctx.setLineDash(object.settings.dash);
			this.#ctx.lineDashOffset = object.settings.dashOffset;
			this.#ctx.lineCap = object.settings.lineCap;
			this.#ctx.lineJoin = object.settings.lineJoin;
			this.#ctx.lineWidth = object.settings.lineWidth;
			this.#ctx.miterLimit = object.settings.miterLimit;
			this.#ctx.strokeStyle = object.settings.strokeStyle;
		}
		if (
			object.settings.shadowBlur > 0 ||
			object.settings.shadowOffsetX != 0 ||
			object.settings.shadowOffsetY != 0
		) {
			this.#ctx.shadowColor = object.settings.shadowColor;
			this.#ctx.shadowBlur = object.settings.shadowBlur;
			this.#ctx.shadowOffsetX = object.settings.shadowOffsetX;
			this.#ctx.shadowOffsetY = object.settings.shadowOffsetY;
		}
		this.#ctx.globalAlpha = object.settings.alpha;
		this.#ctx.direction = object.settings.direction;
		this.#ctx.globalCompositeOperation = object.settings.globalCompositeOperation;

		Object.keys(object.transformation).forEach(key => {
			if (key == 'translate') this.#ctx.translate(object.transformation[key].x, object.transformation[key].y);
			if (key == 'scale') this.#ctx.scale(object.transformation[key].x, object.transformation[key].y);
			if (key == 'rotate') this.#ctx.rotate(object.transformation[key]);
			if (key == 'setTransform') this.#ctx.setTransform(...object.transformation[key]);
		});

		this.#ctx.ellipse(
			object.position.x + Math.round(object.size.width / 2) + object.settings.lineWidth / 2,
			object.position.y + Math.round(object.size.height / 2) + object.settings.lineWidth / 2,
			Math.abs(Math.round(object.size.width / 2) - object.settings.lineWidth),
			Math.abs(Math.round(object.size.height / 2) - object.settings.lineWidth),
			object.settings.rotation,
			object.settings.startAngle,
			object.settings.endAngle,
			object.settings.counterclockwise
		);

		if (object.settings.fill) {
			this.#ctx.fillStyle = object.settings.fillStyle;
			this.#ctx.fill(object.settings.fillRule);
		}

		if (object.settings.lineWidth > 0 || !object.settings.fill) {
			this.#ctx.stroke();
		}

		if ('clip' in object.transformation) {
			this.#ctx.clip(object.transformation['clip']);
		}

		this.#ctx.restore();
	}

	#drawMedia(key) {
		var object = this.#objects[key]

		this.#ctx.save();
		this.#ctx.beginPath();
		if (object.settings.lineWidth > 0) {
			this.#ctx.setLineDash(object.settings.dash);
			this.#ctx.lineDashOffset = object.settings.dashOffset;
			this.#ctx.lineCap = object.settings.lineCap;
			this.#ctx.lineJoin = object.settings.lineJoin;
			this.#ctx.lineWidth = object.settings.lineWidth;
			this.#ctx.miterLimit = object.settings.miterLimit;
			this.#ctx.strokeStyle = object.settings.strokeStyle;
		}
		if (
			object.settings.shadowBlur > 0 ||
			object.settings.shadowOffsetX != 0 ||
			object.settings.shadowOffsetY != 0
		) {
			this.#ctx.shadowColor = object.settings.shadowColor;
			this.#ctx.shadowBlur = object.settings.shadowBlur;
			this.#ctx.shadowOffsetX = object.settings.shadowOffsetX;
			this.#ctx.shadowOffsetY = object.settings.shadowOffsetY;
		}
		this.#ctx.globalAlpha = object.settings.alpha;
		this.#ctx.direction = object.settings.direction;
		this.#ctx.globalCompositeOperation = object.settings.globalCompositeOperation;

		this.#ctx.imageSmoothingEnabled = object.settings.imageSmoothingEnabled;
		this.#ctx.imageSmoothingQuality = object.settings.imageSmoothingQuality;

		Object.keys(object.transformation).forEach(key => {
			if (key == 'translate') this.#ctx.translate(object.transformation[key].x, object.transformation[key].y);
			if (key == 'scale') this.#ctx.scale(object.transformation[key].x, object.transformation[key].y);
			if (key == 'rotate') this.#ctx.rotate(object.transformation[key]);
			if (key == 'setTransform') this.#ctx.setTransform(...object.transformation[key]);
		});
		
		var dx = object.position.x;
		var dy = object.position.y;
		var dWidth = object.size.width;
		var dHeight = object.size.height;

		var sx = 0;
		var sy = 0;
		var sWidth = object.originalSize.width;
		var sHeight = object.originalSize.height;

		if ((dWidth / dHeight).toFixed(1) != (sWidth / sHeight).toFixed(1)) {
			if ((dWidth / dHeight) < (sWidth / sHeight)) {
				sWidth = sHeight * (dWidth / dHeight);
				sx = (object.originalSize.width - sWidth) / 2;
			} else {
				sHeight = sWidth * (dHeight / dWidth);
				sy = (object.originalSize.height - sHeight) / 2;
			}
		}

		if (
			object.settings.lineWidth > 0 ||
			object.settings.radii > 0
		) {
			this.#ctx.roundRect(
				Math.round(object.position.x + object.settings.lineWidth / 2),
				Math.round(object.position.y + object.settings.lineWidth / 2),
				Math.round(object.size.width - object.settings.lineWidth),
				Math.round(object.size.height - object.settings.lineWidth),
				object.settings.radii
			);

			if (object.settings.lineWidth > 0) {
				this.#ctx.stroke();
			}
			if (object.settings.radii > 0) {
				this.#ctx.clip();
			}
		}

		this.#ctx.drawImage(
			object.media,
			Math.round(sx + (sWidth * (object.settings.zoom - 1) / 2)),
			Math.round(sy + (sHeight * (object.settings.zoom - 1) / 2)),
			Math.round(sWidth / object.settings.zoom),
			Math.round(sHeight / object.settings.zoom),
			Math.round(dx + object.settings.lineWidth / 2),
			Math.round(dy + object.settings.lineWidth / 2),
			Math.round(dWidth - object.settings.lineWidth),
			Math.round(dHeight - object.settings.lineWidth)
		);

		this.#ctx.restore();
	}

	#drawText(key) {
		var object = this.#objects[key]

		this.#ctx.save();
		this.#ctx.beginPath();
		if (object.settings.lineWidth > 0) {
			this.#ctx.setLineDash(object.settings.dash);
			this.#ctx.lineDashOffset = object.settings.dashOffset;
			this.#ctx.lineCap = object.settings.lineCap;
			this.#ctx.lineJoin = object.settings.lineJoin;
			this.#ctx.lineWidth = object.settings.lineWidth;
			this.#ctx.miterLimit = object.settings.miterLimit;
			this.#ctx.strokeStyle = object.settings.strokeStyle;
		}
		if (
			object.settings.shadowBlur > 0 ||
			object.settings.shadowOffsetX != 0 ||
			object.settings.shadowOffsetY != 0
		) {
			this.#ctx.shadowColor = object.settings.shadowColor;
			this.#ctx.shadowBlur = object.settings.shadowBlur;
			this.#ctx.shadowOffsetX = object.settings.shadowOffsetX;
			this.#ctx.shadowOffsetY = object.settings.shadowOffsetY;
		}
		this.#ctx.globalAlpha = object.settings.alpha;
		this.#ctx.direction = object.settings.direction;
		this.#ctx.globalCompositeOperation = object.settings.globalCompositeOperation;

		this.#ctx.font = object.settings.font;
		this.#ctx.fontKerning = object.settings.fontKerning;
		this.#ctx.fontStretch = object.settings.fontStretch;
		this.#ctx.fontVariantCaps = object.settings.fontVariantCaps;
		this.#ctx.textAlign = object.settings.textAlign;
		this.#ctx.textBaseline = object.settings.textBaseline;
		this.#ctx.textRendering = object.settings.textRendering;
		this.#ctx.wordSpacing = object.settings.wordSpacing;

		Object.keys(object.transformation).forEach(key => {
			if (key == 'translate') this.#ctx.translate(object.transformation[key].x, object.transformation[key].y);
			if (key == 'scale') this.#ctx.scale(object.transformation[key].x, object.transformation[key].y);
			if (key == 'rotate') this.#ctx.rotate(object.transformation[key]);
			if (key == 'setTransform') this.#ctx.setTransform(...object.transformation[key]);
		});

		if (object.settings.fill) {
			this.#ctx.fillStyle = object.settings.fillStyle;
			this.#ctx.fillText(object.text, object.position.x, object.position.y + object.size.height);
		}

		if (object.settings.lineWidth > 0 || !object.settings.fill) {
			this.#ctx.strokeText(object.text, object.position.x, object.position.y + object.size.height);
		}

		if ('clip' in object.transformation) {
			this.#ctx.clip(object.transformation['clip']);
		}

		this.#ctx.restore();
	}

	#drawEraser(key, position = null) {
		var object = this.#objects[key];

		if (position) {
			this.#ctx.clearRect(
				position.x,
				position.y,
				object.size.width,
				object.size.height
			);
		} else {
			object.positions.forEach(position => {
				this.#ctx.clearRect(
					position.x,
					position.y,
					object.size.width,
					object.size.height
				);
			})
		}
	}

	#reRender(keys, updateTransformation = () => {}) {
		var intersectedKeys = this.#cascadeIntersectionSearch(keys);

		var size = intersectedKeys.length;

		for (var i = size - 1; i > -1; i--) {
			var key = intersectedKeys[i];
			var border = this.#objects[key].settings?.lineWidth ?? 0;
			this.#ctx.clearRect(
				Math.floor(this.#objects[key].AABB.x - border),
				Math.floor(this.#objects[key].AABB.y - border),
				Math.ceil(this.#objects[key].AABB.width + border * 2),
				Math.ceil(this.#objects[key].AABB.height + border * 2)
			);
		}

		updateTransformation();

		this.#render(intersectedKeys);

		this.#requestFrame();

		return intersectedKeys;
	}

	#render(keys = Object.keys(this.#objects)) {
		// this.#drawBackground();

		keys.forEach(key => {
			var object = this.#objects[key];

			if (object) {
				if (object.type == 'line') {
					this.#drawLine(key);
				} else if (object.type == 'rectangle') {
					this.#drawRectangle(key);
				} else if (object.type == 'ellipse') {
					this.#drawEllipse(key);
				} else if (object.type == 'text') {
					this.#drawText(key);
				} else if (object.type == 'eraser') {
					this.#drawEraser(key);
				} else {
					this.#drawMedia(key);
				}
			}
		});
	}

	#reLoop() {
		var FPS = [...new Set(Object.values(this.#objects)
			.filter(object => object.type == 'media' && 'FPS' in object)
			.reduce((acc, object) => acc.concat(object.FPS), []))];

		if (FPS.length == 0) {
			return this.#animate.durations = [];
		}

		var durations = FPS.map(fps => Math.round(1000 / fps)).sort();

		var gcd = this.#GCD(...durations);

		this.#animate.durations = gcd == 1 ? durations : [gcd];

		if (!this.#animate.loop) {
			this.#loop();
		}
	}

	#loop(i = 0) {
		var startTime = performance.now();

		if (!this.#animate.durations.length) {
			return this.#animate.loop = undefined;
		}

		var keys = Object.keys(this.#objects).filter(key => {
			if (
				this.#objects[key].type == 'media' &&
				'FPS' in this.#objects[key] &&
				this.#objects[key].FPS.some(fps => this.#animate.durations.some(duration => duration * i % Math.round(1000 / fps) == 0))
			) {
				return true;
			}

			return false;
		});

		this.#reRender(keys);

		var index = i % this.#animate.durations.length;
		var duration = this.#animate.durations[index] - (this.#animate.durations[index - 1] ?? 0)

		var delay = performance.now() - startTime;
		this.#animate.loop = setTimeout(() => this.#loop(++i % Number.MAX_SAFE_INTEGER), Math.max(0, Math.round(duration - delay)));
	}

	#requestFrame() {
		if (this.#stream) {
			if ('requestFrame' in this.#stream) {
				this.#stream.requestFrame();
			} else {
				this.#stream.getVideoTracks().forEach(track => track.requestFrame());
			}
		}
	}

	#updateAABB(AABB, {
		x,
		y
	}) {
		var size = {
			x: AABB.x + AABB.width,
			y: AABB.y + AABB.height
		};

		size.x = Math.max(size.x, x);
		size.y = Math.max(size.y, y);

		AABB.x = Math.min(AABB.x, x);
		AABB.y = Math.min(AABB.y, y);
		AABB.width = size.x - AABB.x;
		AABB.height = size.y - AABB.y;

		return AABB;
	}

	// #rangeSearch() {}

	#cascadeIntersectionSearch(keys) {
		var objectKeys = Object.keys(this.#objects).filter(key => !keys.includes(key));

		var keysLength = keys.length;
		var objectKeysLength = objectKeys.length;

		var i = 0;
		while(i < keysLength) {
			for (var j = 0; j < objectKeysLength; j++) {
				var border = this.#objects[keys[i]].settings?.lineWidth ?? 0;
				var AABB1 = {
					x: Math.floor(this.#objects[keys[i]].AABB.x - border),
					y: Math.floor(this.#objects[keys[i]].AABB.y - border),
					width: Math.ceil(this.#objects[keys[i]].AABB.width + border),
					height: Math.ceil(this.#objects[keys[i]].AABB.height + border)
				};

				border = this.#objects[objectKeys[j]].settings?.lineWidth ?? 0;
				var AABB2 = {
					x: Math.floor(this.#objects[objectKeys[j]].AABB.x - border),
					y: Math.floor(this.#objects[objectKeys[j]].AABB.y - border),
					width: Math.ceil(this.#objects[objectKeys[j]].AABB.width + border),
					height: Math.ceil(this.#objects[objectKeys[j]].AABB.height + border)
				};

				if (this.#intersectionBetweenAABB(AABB1, AABB2)) {
					keys.push(objectKeys[j]);
					objectKeys.splice(j, 1);

					keysLength++;
					objectKeysLength--;

					j--;
				}
			}
			i++;
		}

		return keys.sort();
	}

	#intersectionBetweenAABB(AABB1, AABB2) {
		return !(
			(AABB1.x + AABB1.width) < AABB2.x ||
			(AABB1.y + AABB1.height) < AABB2.y ||
			AABB1.x > (AABB2.x + AABB2.width) ||
			AABB1.y > (AABB2.y + AABB2.height)
		)
	}

	#catmullRomSpline({P0, P1, P2, P3}, t, alpha = 0.5) {
		const getT = (P0, P1, t, alpha) => Math.pow(Math.sqrt(Math.pow(P1.x - P0.x, 2) + Math.pow(P1.y - P0.y, 2)), alpha) + t;

		let t0 = 0;
		let t1 = getT(P0, P1, t0, alpha);
		let t2 = getT(P1, P2, t1, alpha);
		let t3 = getT(P2, P3, t2, alpha);
		t = (t2 - t1) * t + t1;

		let A1 = {
			x: (t1 - t) / (t1 - t0) * P0.x + (t - t0) / (t1 - t0) * P1.x,
			y: (t1 - t) / (t1 - t0) * P0.y + (t - t0) / (t1 - t0) * P1.y
		}
		let A2 = {
			x: (t2 - t) / (t2 - t1) * P1.x + (t - t1) / (t2 - t1) * P2.x,
			y: (t2 - t) / (t2 - t1) * P1.y + (t - t1) / (t2 - t1) * P2.y
		}
		let A3 = {
			x: (t3 - t) / (t3 - t2) * P2.x + (t - t2) / (t3 - t2) * P3.x,
			y: (t3 - t) / (t3 - t2) * P2.y + (t - t2) / (t3 - t2) * P3.y
		}

		let B1 = {
			x: (t2 - t) / (t2 - t0) * A1.x + (t - t0) / (t2 - t0) * A2.x,
			y: (t2 - t) / (t2 - t0) * A1.y + (t - t0) / (t2 - t0) * A2.y
		};
		let B2 = {
			x: (t3 - t) / (t3 - t1) * A2.x + (t - t1) / (t3 - t1) * A3.x,
			y: (t3 - t) / (t3 - t1) * A2.y + (t - t1) / (t3 - t1) * A3.y
		};

		return {
			x: (t2 - t) / (t2 - t1) * B1.x + (t - t1) / (t2 - t1) * B2.x,
			y: (t2 - t) / (t2 - t1) * B1.y + (t - t1) / (t2 - t1) * B2.y
		};
	}

	#euclideanDistance(point1, point2) {
		var deltaX = point2.x - point1.x;
		var deltaY = point2.y - point1.y;

		return Math.sqrt(deltaX ** 2 + deltaY ** 2);
	}

	#GCD(...numbers) {
		if (numbers.length < 1) {
			throw new Error("At least one numbers are needed to calculate GCD.");
		} else if (numbers.length == 1) {
			return numbers[0];
		}

		function gcd(a, b) {
			while (b !== 0) {
				var temp = b;
				b = a % b;
				a = temp;
			}
			return a;
		}

		var res = numbers[0];
		for (var i = 1; i < numbers.length; i++) {
			res = gcd(Math.round(res), Math.round(numbers[i]));
		}

		return res;
	}

	#getSizeElement(media) {
		var width, height;

		if (
			media instanceof HTMLCanvasElement ||
			media instanceof OffscreenCanvas ||
			media instanceof ImageBitmap
		) {
			width = media.width;
			height = media.height;
		} else if ('VideoFrame' in window && media instanceof VideoFrame) {
			width = media.displayWidth;
			height = media.displayHeight;
		} else if (media instanceof SVGImageElement) {
			width = media.width.baseVal.value;
			height = media.height.baseVal.value;
		} else if (media instanceof HTMLImageElement) {
			width = media.naturalWidth;
			height = media.naturalHeight;
		} else if (media instanceof HTMLVideoElement) {
			width = media.videoWidth;
			height = media.videoHeight;
		} else {
			throw new Error('Invalid media type');
		}

		return { width, height };
	};

	#SVGAnimateProperties(svg) {
		var animations = [];

		var durationToMilliseconds = duration => {
			var [value, unit] = duration.match(/(-?\d+(?:\.?\d+)?)([a-z]+)?/i).slice(1);
			var milliseconds = 0;

			switch (unit) {
				case '%':
					milliseconds = 1000 * (value / 100);
				break;
				case 'ms':
					milliseconds = value;
				break;
				case 's':
					milliseconds = value * 1000;
				break;
				default:
					milliseconds = value * 1000;
				break;
			}

			return milliseconds;
		};

		var svgDocument = new DOMParser().parseFromString(svg, 'image/svg+xml');
		var svgElement = svgDocument.documentElement;

		var SVGAnimateElement = svgElement.querySelectorAll('animate');
		var SVGAnimateTransformElement = svgElement.querySelectorAll('animateTransform');
		var SVGAnimateMotionElement = svgElement.querySelectorAll('animateMotion');
		var SVGSetElement = svgElement.querySelectorAll('set');

		var SVGElement = [...SVGAnimateElement, ...SVGAnimateTransformElement, ...SVGAnimateMotionElement, ...SVGSetElement];

		// https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute#animation_timing_attributes
		if (SVGElement?.length) {
			SVGElement.forEach(element => {
				var begin = 0, delay = 0, duration = 0, max = 0, min = 0, iterations = 1;

				if (element.attributes.begin?.value) {
					var ms = durationToMilliseconds(element.attributes.begin?.value);

					if (ms > begin) {
						begin = ms
					}
				}
				if (element.attributes.dur?.value) {
					var ms = durationToMilliseconds(element.attributes.dur?.value);

					if (ms > duration) {
						duration = ms
					}
				}
				if (element.attributes.min?.value) {
					var ms = durationToMilliseconds(element.attributes.min?.value);

					if (ms > min) {
						min = ms
					}
				}

				if (element.attributes.end?.value) {
					var ms = durationToMilliseconds(element.attributes.end?.value);

					if (ms > max) {
						max = ms
					}
				}
				if (element.attributes.max?.value) {
					var ms = durationToMilliseconds(element.attributes.max?.value);

					if (ms > max) {
						max = ms
					}
				}
				if (element.attributes.repeatDur?.value) {
					var ms = durationToMilliseconds(element.attributes.repeatDur?.value);

					if (ms > max) {
						max = ms
					}
				}

				if (element.attributes.restart?.value?.trim()?.toLowerCase() == 'never') {
					iterations = 1;
				} else {
					iterations = Infinity;
				}
				if (
					typeof element.attributes.repeatCount?.value == 'string' &&
					element.attributes.repeatCount?.value?.trim()?.toLowerCase() == 'indefinite'
				) {
					iterations = Infinity;
				} else if (
					element.attributes.repeatCount?.value &&
					+element.attributes.repeatCount?.value > iterations
				) {
					iterations = +element.attributes.repeatCount?.value;
				}

				animations.push({
					begin,
					delay,
					duration,
					max,
					min,
					iterations
				});
			});
		}

		var stylesheet = new CSSStyleSheet();
		stylesheet.replaceSync(Array.from(svgElement.querySelectorAll('style')).map(style => style.textContent).join(' '));

		var cssRules = Object.values(stylesheet.cssRules);
		var nodes = Array.from(svgElement.childNodes);
		var CSSRulesAnimation = [
			...cssRules.filter(rule => rule.style?.getPropertyValue('animation')),
			...nodes.filter(node => node.style?.getPropertyValue('animation-name'))
		];
		var CSSRulesTransition = [
			...cssRules.filter(rule => rule.style?.getPropertyValue('transition')),
			...nodes.filter(node => node.style?.getPropertyValue('transition'))
		];

		// https://developer.mozilla.org/en-US/docs/Web/CSS/animation
		if (CSSRulesAnimation?.length) {
			CSSRulesAnimation.forEach(animation => {
				var begin = 0, delay = 0, duration = 0, max = 0, min = 0, iterations = 1;

				if (animation.style.animationDelay) {
					animation.style.animationDelay.split(',').map(animationDelay => durationToMilliseconds(animationDelay.trim())).forEach(animationDelay => {
						if (animationDelay > delay) {
							delay = animationDelay;
						}
					});
				}
				if (animation.style.animationDuration) {
					animation.style.animationDuration.split(',').map(animationDuration => durationToMilliseconds(animationDuration.trim())).forEach(animationDuration => {
						if (animationDuration > duration) {
							duration = animationDuration;
						}
					});
				}
				if (animation.style.animationIterationCount) {
					animation.style.animationIterationCount.split(',').map(i => i.trim()).forEach(animationIterationCount => {
						if (
							typeof animationIterationCount == 'string' &&
							animationIterationCount.toLowerCase() == 'infinite'
						) {
							iterations = Infinity;
						} else if (+animationIterationCount > iterations) {
							iterations = animationIterationCount;
						}
					});
				}

				animations.push({
					begin,
					delay,
					duration,
					max,
					min,
					iterations
				});
			});
		}

		// https://developer.mozilla.org/en-US/docs/Web/CSS/transition
		if (CSSRulesTransition?.length) {
			CSSRulesTransition.forEach(transition => {
				var begin = 0, delay = 0, duration = 0, max = 0, min = 0, iterations = 1;

				if (transition.style.transitionDelay) {
					transition.style.transitionDelay.split(',').map(transitionDelay => durationToMilliseconds(transitionDelay.trim())).forEach(transitionDelay => {
						if (transitionDelay > delay) {
							delay = transitionDelay;
						}
					});
				}
				if (transition.style.transitionDuration) {
					transition.style.transitionDuration.split(',').map(transitionDuration => durationToMilliseconds(transitionDuration.trim())).forEach(transitionDuration => {
						if (transitionDuration > duration) {
							duration = transitionDuration;
						}
					});
				}

				animations.push({
					begin,
					delay,
					duration,
					max,
					min,
					iterations
				});
			});
		}

		if (animations.length) {
			var duration = 0, iterations = 0;

			animations.forEach(animation => {
				var totalDuration = animation.begin + animation.delay + animation.duration;

				if (
					animation.min &&
					totalDuration < animation.min
				) {
					totalDuration = animation.min;
				}
				if (
					animation.max &&
					totalDuration > animation.max
				) {
					totalDuration = animation.max;
				}
				if (totalDuration > duration) {
					duration = totalDuration;
				}

				if (iterations < animation.iterations) {
					iterations = animation.iterations;
				}
			});

			if (duration && iterations) {
				return {
					duration,
					iterations
				};
			}
		}

		return null;
	}
}
