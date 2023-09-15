class Canvas {
	#canvas
	#ctx
	#contentHint
	#stream

	#objects = {}
	#undone = {}
	#animate = {
		loop: undefined,
		interval: undefined
	}

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
		BSplineIterations = 2
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
			globalCompositeOperation
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
			point: async (x, y, minDistance = 1) => {
				var point = {
					x,
					y
				};
	
				if (this.#euclideanDistance(this.#objects[key].lastPoints.at(-1), point) > minDistance) {
					this.#objects[key].AABB = this.#updateAABB(this.#objects[key].AABB, point);

					if (this.#objects[key].lastPoints.length % 2 == 0) {
						var lastPoints = this.#objects[key].lastPoints.splice(0, 2).concat(point)
						this.#objects[key].lastPoints.unshift(point);

						var path = new Path2D();
						path.moveTo(lastPoints[0].x, lastPoints[0].y);

						this.#BSpline(lastPoints, BSplineIterations).forEach((point, i) => {
							path.lineTo(point.x, point.y);
							this.#objects[key].path.lineTo(point.x, point.y);
						});

						path.lineTo(point.x, point.y);
						this.#objects[key].path.lineTo(point.x, point.y);

						this.#drawLine(key, path);

						this.#requestFrame();
					} else {
						this.#objects[key].lastPoints.push(point);
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
				BSplineIterations = this.#objects[key].settings.globalCompositeOperation,
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
						BSplineIterations
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

	media(media, {
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

		var videoTracks = [];
		if ('captureStream' in media) {
			videoTracks = media.captureStream()?.getVideoTracks();
			videoTracks.forEach(track => track.contentHint = contentHint);
			this.#objects[key].FPS = videoTracks.map(track => Math.round(track.getSettings()?.frameRate))
		}

		if ('requestVideoFrameCallback' in media) {
			media.requestVideoFrameCallback(() => {
				console.log('oi');
			});
		}

		this.#drawMedia(key);
		this.#reLoop();
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
		var FPS = Object.values(this.#objects)
			.filter(object => object.type == 'media' && 'FPS' in object)
			.reduce((acc, object) => acc.concat(object.FPS), []);

		if (FPS.length == 0) {
			return this.#animate.interval = undefined;
		}

		this.#animate.interval = this.#GCD(...FPS);

		if (!this.#animate.loop) {
			this.#loop();
		}
	}

	#loop(i = 1) {
		if (!this.#animate.interval || this.#animate.interval < 1) {
			return this.#animate.loop = undefined;
		}
	
		var startTime = Date.now();

		// If there was a specific array for averages, it would be faster
		var keys = Object.keys(this.#objects).filter(key => {
			if (
				this.#objects[key].type == 'media' &&
				'FPS' in this.#objects[key] &&
				this.#objects[key].FPS.some(fps => this.#animate.interval * i % fps == 0)
			) {
				return true;
			}

			return false;
		});

		this.#reRender(keys);

		var delay = Date.now() - startTime;
		this.#animate.loop = setTimeout(() => this.#loop(++i), Math.max(0, parseInt((1000 / this.#animate.interval) - delay)));
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

	#BSpline(arr, iterations = 2) {
		if (iterations == 0) return arr;

		var smooth = [];

		var size = arr.length;
		for (var i = 0; i < size - 1; i++) {
				smooth.push(
					{
						x: 0.75 * arr[i].x + 0.25 * arr[i + 1].x,
						y: 0.75 * arr[i].y + 0.25 * arr[i + 1].y
					},
					{
						x: 0.25 * arr[i].x + 0.75 * arr[i + 1].x,
						y: 0.25 * arr[i].y + 0.75 * arr[i + 1].y
					}
				);
		}

		return iterations == 1 ? smooth : this.#BSpline(smooth, iterations - 1);
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
			res = gcd(res, numbers[i]);
		}

		return res;
	}

	#getSizeElement(media) {
		var width, height;

		if (
			media instanceof OffscreenCanvas ||
			media instanceof ImageBitmap
		) {
			width = media.width;
			height = media.height;
		} else if (media instanceof VideoFrame) {
			width = media.displayWidth;
			height = media.displayHeight;
		} else if (media instanceof HTMLElement) {
			if (media.tagName == 'IMG') {
				width = media.naturalWidth;
				height = media.naturalHeight;
			} else if (media.tagName == 'VIDEO') {
				width = media.videoWidth;
				height = media.videoHeight;
			} else if (media.tagName == 'CANVAS') {
				width = media.width;
				height = media.height;
			}
		}

		return { width, height };
	};
}
