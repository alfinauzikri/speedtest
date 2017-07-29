//@ts-check

/**
 *
 *
 * @class SpeedTestWorker
 */
class SpeedTestWorker {
    /**
     * Creates an instance of SpeedTestWorker.
     * @param {any} scope
     */
    constructor(scope) {
        this.scope = scope;

        // possible test status values
        this.STATUS = {
            WAITING: 'waiting',
            STARTING: 'starting',
            RUNNING: 'running',
            DONE: 'done',
            ABORTED: 'aborted',
            FAILED: 'failed',
        };
        this.STEP = {
            IP: 'ip',
            LATENCY: 'latency',
            DOWNLOAD: 'download',
            UPLOAD: 'upload',
        };

        // initialize test data
        this.test = {
            running: false,
            status: this.STATUS.WAITING,
            step: null,
            error: false,
            data: {},
            requests: [],
        };

        // the default configuration
        this.config = {
            ignoreErrors: true,
            optimize: false,
            mode: 'websocket', // 'websocket' or 'xhr'
            ip: {
                url: 'ip.php',
            },
            latency: {
                url: 'empty.php',
                count: null,
                duration: 5,
                gracetime: 1,
            },
            download: {
                url: 'data.php',
                streams: 5,
                size: 20,
                dataType: 'blob', // 'arraybuffer' or 'blob'
                adaptative: false,
                duration: 15,
                gracetime: 2,
            },
            upload: {
                url: 'empty.php',
                streams: 3,
                size: 20,
                adaptative: false,
                duration: 15,
                gracetime: 2,
            },
        };
        // TODO: add a setting (optimize) to auto adjust this.config to best values following the browser in use

        this.scope.addEventListener('message', this.processMessage.bind(this));
    }

    /**
     *
     *
     * @param {any} event
     */
    processMessage(event) {
        switch (event.data) {
            case 'abort':
                this.abort();
                this.postStatus();
                break;
            case 'config':
                this.scope.postMessage(this.test.config);
                break;
            case 'start':
                this.run()
                    .then(() => {
                        this.postStatus();
                    })
                    .catch(reason => {
                        console.error('FAIL', reason);
                    });
                break;
            case 'status':
                this.postStatus();
                break;
        }
    }

    postStatus() {
        this.scope.postMessage({
            'status': this.test.status,
            'step': this.test.step,
            'results': this.test.results
        });
    }

    /**
     *
     *
     * @param {any} path
     * @returns
     */
    getPerformanceEntry(path) {
        let performanceEntry = null;

        // get performance entries
        // TODO: Fix for Firefox and IE 11 as they have partial performance object in scope
        let performanceEntries = this.scope.performance.getEntries();

        // walk entries starting from the most recent, until we find one matching the requested path
        performanceEntries = performanceEntries.reverse();
        performanceEntries.forEach(entry => {
            if (new RegExp(path.replace('?', '\\?')).test(entry.name)) {
                performanceEntry = entry;
            }
        }, this);

        // Browser keeps only the first 150 entries
        if (performanceEntries.length > 120) {
            this.scope.performance.clearResourceTimings();
        }

        return performanceEntry;
    }

    /**
     *
     *
     * @param {any} requests
     * @returns
     */
    clearRequests(requests) {
        if (!Array.isArray(requests) ||
            0 === requests.length
        ) {
            return;
        }

        requests.forEach((request, index) =>     {
            if (request instanceof WebSocket) {
                this.clearWebSocket(request);
            }

            if (request instanceof XMLHttpRequest) {
                this.clearXMLHttpRequest(request);
            }

            // Delete instance
            try {
                request = null;
                delete(requests[index]);
            } catch (ex) {}
        }, this);

        requests = null;
    }

    /**
     *
     * @param {WebSocket} socket
     */
    clearWebSocket(socket) {
        // Close socket
        try {
            socket.close();
        } catch (ex) {}
        // Clear event handlers
        try {
            socket.onopen = null;
            socket.onmessage = null;
            socket.onclose = null;
            socket.onerror = null;
        } catch (ex) {}
    }

    /**
     *
     *
     * @param {XMLHttpRequest} request
     */
    clearXMLHttpRequest(xhr) {
        // Close XHR
        try {
            xhr.abort();
        } catch (ex) {}
        // Clear event handlers
        try {
            xhr.onprogress = null;
            xhr.onload = null;
            xhr.onerror = null;
        } catch (ex) {}
        try {
            xhr.upload.onprogress = null;
            xhr.upload.onload = null;
            xhr.upload.onerror = null;
        } catch (ex) {}
    }

    /**
     *
     *
     * @returns
     */
    testIP() {
        const run = () => {
            // return a promise to chain tests one after another
            return new Promise((resolve, reject) => {
                // compute endpoint URI with a random part for cache busting
                const endpoint = this.config.ip.url +
                    '?ip' + Math.random();

                // build the XHR request
                const xhr = new XMLHttpRequest();

                // mark the request as an async GET on endpoint
                xhr.open('GET', endpoint, true);

                // track request completion
                xhr.onload = e => {
                    this.test.results.ip = xhr.response;

                    // clear XHR
                    this.clearXMLHttpRequest(xhr);

                    resolve();
                };

                // track request errors
                xhr.onerror = () => {
                    reject({
                        status: this.STATUS.FAILED,
                        error: 'test failed',
                    });
                };

                // dispatch request
                xhr.send();
            });
        };

        // initialize ip test
        this.ip = {
            status: this.STATUS.STARTING,
            running: true,
            data: []
        };

        // return ip test promise
        return run()
            .catch(reason => {
                // store error
                this.ip.error = reason;

                // erase results
                this.test.results.ip = null;
            })
            .then(() => {
                this.ip.running = false;

                // broadcast status
                this.processMessage({
                    data: 'status'
                });

                // cancel any remaining request
                this.clearRequests(this.test.requests);

                // propagate error
                if (this.ip.error) {
                    throw (this.ip.error);
                }
            });
    }

    /**
     *
     *
     * @returns
     */
    testLatency() {
        const run = () => {
            return this.testLatencyXHR();
        };

        // initialize latency test
        this.latency = {
            initDate: Date.now(),
            status: this.STATUS.STARTING,
            running: true,
            data: []
        };

        // handle grace time, then mark test as running
        this.scope.setTimeout(
            () => {
                this.latency.status = this.STATUS.RUNNING;
                this.latency.startDate = Date.now();
            },
            this.config.latency.gracetime * 1000
        );
        // handle duration time, then mark test as complete
        this.scope.setTimeout(
            () => {
                this.latency.status = this.STATUS.DONE;
                this.latency.running = false;
            },
            this.config.latency.duration * 1000
        );

        // return latency test promise
        return run()
            .then(() => {
                // compute stats
                this.processLatencyResults();
            })
            .catch(reason => {
                // store error
                this.latency.error = reason;

                // erase results
                this.test.results.latency = null;
            })
            .then(() => {
                this.latency.running = false;

                // cancel any remaining request
                this.clearRequests(this.test.requests);

                // propagate error
                if (this.latency.error) {
                    throw (this.latency.error);
                }
            });
    }

    /**
     *
     *
     * @param {number} [index=1]
     *
     * @returns
     *
     */
    testLatencyXHR(index = 1) {
        // return a promise to chain tests one after another
        return new Promise((resolve, reject) => {
            // test isn't running anymore, exit right away
            if (!this.latency.running) {
                resolve();
                return;
            }

            // test is aborted, exit with status
            if (this.STATUS.ABORTED === this.test.status) {
                reject({
                    status: this.STATUS.ABORTED
                });
                return;
            }

            // compute endpoint URI with a random part for cache busting
            const endpoint = this.config.latency.url +
                '?latency' + Math.random();

            // build the XHR request
            const xhr = new XMLHttpRequest();

            // store the request in case we need to cancel it later
            this.test.requests[index] = xhr;

            // mark the request as an async GET on endpoint
            xhr.open('GET', endpoint, true);

            // track request progress
            xhr.onprogress = e => {
                // test isn't running anymore, exit right away
                if (!this.latency.running) {
                    resolve();
                    return;
                }

                // test is aborted, exit with status
                if (this.STATUS.ABORTED === this.test.status) {
                    reject({
                        status: this.STATUS.ABORTED
                    });
                    return;
                }
            };

            // track request completion
            xhr.onload = e => {
                // test isn't running anymore, exit right away
                if (!this.latency.running) {
                    resolve();
                    return;
                }

                // test is in grace time as long as it is on "starting" status
                if (this.STATUS.STARTING !== this.latency.status) {
                    // upon completion, we got a "pong"
                    const pongDate = Date.now();
                    // by default, latency is delay between "ping" and "pong"
                    let networkLatency = pongDate - pingDate;

                    // seek for a performance entry, more precise than the "ping / pong" calculation
                    const performanceEntry = this.getPerformanceEntry(endpoint);
                    if (null !== performanceEntry) {
                        // latency is the duration between the moment the request is issued and the moment we get the first byte of response
                        networkLatency = performanceEntry.responseStart - performanceEntry.requestStart;
                    }

                    // format and store the result
                    networkLatency = +networkLatency.toFixed(2);
                    this.latency.data.push(networkLatency);

                    // compute stats
                    this.processLatencyResults();
                }

                // track progression
                if (
                    this.config.latency.count &&
                    index >= this.config.latency.count
                ) {
                    // test is done
                    resolve();
                    return;
                }

                // wait for grace time before issuing next ping
                this.scope.setTimeout(
                    () => {
                        this.testLatencyXHR(index + 1)
                            .then(resolve)
                            .catch(reject);
                    },
                    this.config.latency.gracetime
                );
            };

            // track request errors
            xhr.onerror = () => {
                if (this.config.ignoreErrors) {
                    // prepare next loop
                    return this.testLatencyXHR(index + 1)
                        .then(resolve)
                        .catch(reject);
                }

                reject({
                    status: this.STATUS.FAILED,
                    error: 'test failed',
                });
            };

            // dispatch request
            xhr.send();

            // mark dispatch time as "ping"
            const pingDate = Date.now();
        });
    }

    /**
     *
     *
     * @returns
     */
    processLatencyResults() {
        // compute test durations
        const durationFromInit = (Date.now() - this.latency.initDate) / 1000;

        // compute progress
        const progress = durationFromInit / this.config.latency.duration;

        // gather the processed latencies
        const latencies = this.latency.data;

        // store results
        this.test.results.latency = {
            min: +Math.min.apply(null, latencies).toFixed(2),
            max: +Math.max.apply(null, latencies).toFixed(2),
            avg: +(
                latencies.reduce((a, b) => a + b, 0) /
                latencies.length
            ).toFixed(2),
            jitter: 0,
            progress: progress
        };

        // nothing else to do without at least two values
        if (latencies.length < 2) {
            return;
        }

        // process latencies by pair to compute jitter
        latencies.forEach((value, index) => {
            if (0 === index) {
                return;
            }

            // RFC 1889 (https://www.ietf.org/rfc/rfc1889.txt):
            // J=J+(|D(i-1,i)|-J)/16
            const deltaPing = Math.abs(latencies[index - 1] - latencies[index]);
            this.test.results.latency.jitter += (deltaPing - this.test.results.latency.jitter) / 16.0;
        }, this);
        this.test.results.latency.jitter = +this.test.results.latency.jitter.toFixed(2);
    }

    /**
     *
     *
     * @returns
     */
    testDownloadSpeed() {
        const run = (size, delay = 0) => {
            if ('websocket' === this.config.mode) {
                return this.testDownloadSpeedWebSocket(size, delay);
            }
            return this.testDownloadSpeedXHR(size, delay);
        };

        // initialize download test
        this.download = {
            initDate: Date.now(),
            status: this.STATUS.STARTING,
            running: true,
            startDate: null,
            size: 0,
            test: {
                index: 0,
                promises: []
            }
        };

        // prepare and launch download streams
        for (let index = 0; index < this.config.download.streams; index++) {
            const testPromise = run(
                this.config.download.size,
                index * 100
            );
            this.download.test.promises.push(testPromise);
        }

        // handle grace time, then mark test as running
        this.scope.setTimeout(
            () => {
                this.download.status = this.STATUS.RUNNING;
                this.download.startDate = Date.now();
            },
            this.config.download.gracetime * 1000
        );
        // handle duration time, then mark test as complete
        this.scope.setTimeout(
            () => {
                this.download.status = this.STATUS.DONE;
                this.download.running = false;
            },
            this.config.download.duration * 1000
        );

        // listen for download streams completion before giving back hand for next test
        return Promise.all(this.download.test.promises)
            .then(() => {
                // compute stats
                this.processDownloadSpeedResults();
            })
            .catch(reason => {
                // store error
                this.download.error = reason;

                // erase results
                this.test.results.latency = null;
            })
            .then(() => {
                this.download.running = false;

                // cancel any remaining request
                this.clearRequests(this.test.requests);

                // propagate error
                if (this.download.error) {
                    throw (this.download.error);
                }
            });
    }

    /**
     *
     *
     * @param {any} size
     * @param {number} [delay=0]
     * @param {any} [startDate=Date.now()]
     * @returns
     */
    testDownloadSpeedWebSocket(size, delay = 0, startDate = Date.now()) {
        // store test index
        const index = this.download.test.index++;

        // return a promise to chain tests one after another
        return new Promise((resolve, reject) => {
            // test isn't running anymore, exit right away
            if (!this.download.running) {
                resolve();
                return;
            }

            // test is aborted, exit with status
            if (this.STATUS.ABORTED === this.test.status) {
                reject({
                    status: this.STATUS.ABORTED
                });
                return;
            }

            // open a WebSocket connection
            const socket = new WebSocket('ws://127.0.0.1:9000/');

            // store the request in case we need to cancel it later
            this.test.requests[index] = socket;

            // track request completion
            socket.onmessage = e => {
                this.download.size += e.data.length;

                // close socket
                socket.close();

                // compute stats
                this.processDownloadSpeedResults();

                // prepare next loop
                this.testDownloadSpeedWebSocket(size)
                    .then(resolve)
                    .catch(reject);
            };

            // track socket closing
            socket.onclose = () => {
                // clear WebSocket
                this.clearWebSocket(socket);
            };

            // track request errors
            socket.onerror = e => {
                if (this.config.ignoreErrors) {
                    // prepare next loop
                    return this.testDownloadSpeedWebSocket(size)
                        .then(resolve)
                        .catch(reject);
                }

                reject({
                    status: this.STATUS.FAILED,
                    error: 'test failed',
                });
            };

            // delay request dispatching as configured
            socket.onopen = () => {
                this.scope.setTimeout(
                    () => {
                        socket.send('download ' + size);
                    },
                    delay
                );
            };
        });
    }

    /**
     *
     *
     * @param {any} size
     * @param {number} [delay=0]
     * @param {number} [startDate=Date.now()]
     * @returns
     */
    testDownloadSpeedXHR(size, delay = 0, startDate = Date.now()) {
        // store test index
        const index = this.download.test.index++;

        // return a promise to chain tests one after another
        return new Promise((resolve, reject) => {
            // test isn't running anymore, exit right away
            if (!this.download.running) {
                resolve();
                return;
            }

            // test is aborted, exit with status
            if (this.STATUS.ABORTED === this.test.status) {
                reject({
                    status: this.STATUS.ABORTED
                });
                return;
            }

            // compute endpoint URI with the chunk size and a random part for cache busting
            const endpoint = this.config.download.url +
                '?download' + Math.random() +
                '&size=' + size;

            // build the XHR request
            const xhr = new XMLHttpRequest();

            // store the request in case we need to cancel it later
            this.test.requests[index] = xhr;

            // set up the correct data response type
            xhr.responseType = this.config.download.dataType;

            // mark the request as an async GET on endpoint
            xhr.open('GET', endpoint, true);

            // initialize size loaded for this request
            let sizeLoaded = 0;

            // track request progress
            xhr.onprogress = e => {
                // test is not running any more, exit
                if (!this.download.running) {
                    resolve();
                    return;
                }

                // test is aborted, exit with status
                if (this.STATUS.ABORTED === this.test.status) {
                    reject({
                        status: this.STATUS.ABORTED
                    });
                    return;
                }

                // compute the size of the loaded chunk
                const loadDiff = e.loaded - sizeLoaded;

                // remember the the loaded size for next progress tacking
                sizeLoaded = e.loaded;

                // test is in grace time as long as it is on "starting" status
                if (this.STATUS.STARTING === this.download.status) {
                    return;
                }

                // add the chunk size to the total loaded size
                this.download.size += loadDiff;

                // compute stats
                this.processDownloadSpeedResults();
            };

            // track request completion
            xhr.onload = e => {
                // store current date and time
                const now = Date.now();

                // adjust chunk size of next loop if adaptive mode is enabled
                if (this.config.download.adaptative) {
                    // loading was too fast? increase size
                    if (now - startDate < 500) {
                        size *= 2;
                    }
                    // loading was too slow? decrease size
                    if (now - startDate > 1000) {
                        size /= 2;
                    }
                }

                // clear XHR
                this.clearXMLHttpRequest(xhr);

                // prepare next loop
                this.testDownloadSpeedXHR(size)
                    .then(resolve)
                    .catch(reject);
            };

            // track request errors
            xhr.onerror = () => {
                if (this.config.ignoreErrors) {
                    // prepare next loop
                    return this.testDownloadSpeedXHR(size)
                        .then(resolve)
                        .catch(reject);
                }

                reject({
                    status: this.STATUS.FAILED,
                    error: 'test failed',
                });
            };

            // delay request dispatching as configured
            this.scope.setTimeout(
                () => {
                    xhr.send(null);
                },
                delay
            );
        });
    }

    /**
     *
     *
     */
    processDownloadSpeedResults() {
        // compute test durations
        const durationFromInit = (Date.now() - this.download.initDate) / 1000;
        const durationFromStart = (Date.now() - this.download.startDate) / 1000;

        // compute progress
        const progress = durationFromInit / this.config.download.duration;

        // compute bandwidth
        const {
            bitBandwidth: bandwidth
        } = this.computeBandwidth(this.download.size, durationFromStart);

        // store results
        this.test.results.download = {
            speed: +bandwidth.toFixed(2),
            progress: progress,
        };
    }

    /**
     *
     *
     * @returns
     */
    getRandomData() {
        // prepare a random data buffer of 1MB
        const buffer = new Float32Array(new ArrayBuffer(1048576));
        for (var index = 0; index < buffer.length; index++) {
            buffer[index] = Math.random();
        }
        // build the data array of desired size from the 1MB buffer
        let data = [];
        for (let i = 0; i < this.config.upload.size; i++) {
            data.push(buffer);
        }
        return new Blob(data, {
            type: 'application/octet-stream'
        });
    }

    /**
     *
     *
     */
    testUploadSpeed() {
        const run = (size, delay = 0) => {
            return this.testUploadSpeedXHR(size, delay);
        };

        // initialize upload test
        this.upload = {
            initDate: Date.now(),
            status: this.STATUS.STARTING,
            running: true,
            startDate: null,
            size: 0,
            test: {
                index: 0,
                promises: [],
                data: this.getRandomData()
            }
        };

        // prepare and launch upload streams
        for (let index = 0; index < this.config.upload.streams; index++) {
            const testPromise = run(
                this.config.upload.size,
                index * 100
            );
            this.upload.test.promises.push(testPromise);
        }

        // handle grace time, then mark test as running
        this.scope.setTimeout(
            () => {
                this.upload.status = this.STATUS.RUNNING;
                this.upload.startDate = Date.now();
            },
            this.config.upload.gracetime * 1000
        );
        // handle duration time, then mark test as complete
        this.scope.setTimeout(
            () => {
                this.upload.status = this.STATUS.DONE;
                this.upload.running = false;
            },
            this.config.upload.duration * 1000
        );

        // listen for upload streams completion before giving back hand for next test
        return Promise.all(this.upload.test.promises)
            .then(() => {
                // compute stats
                this.processUploadSpeedResults();
            })
            .catch(reason => {
                // store error
                this.upload.error = reason;

                // erase results
                this.test.results.latency = null;
            })
            .then(() => {
                this.upload.running = false;

                // cancel any remaining request
                this.clearRequests(this.test.requests);

                // propagate error
                if (this.upload.error) {
                    throw (this.upload.error);
                }
            });
    }

    testUploadSpeedXHR(size, delay = 0, startDate = Date.now()) {
        // store test index
        const index = this.upload.test.index++;

        // return a promise to chain tests one after another
        return new Promise((resolve, reject) => {
            // test isn't running anymore, exit right away
            if (!this.upload.running) {
                resolve();
                return;
            }

            // test is aborted, exit with status
            if (this.STATUS.ABORTED === this.test.status) {
                reject({
                    status: this.STATUS.ABORTED
                });
                return;
            }

            // compute endpoint URI with the chunk size and a random part for cache busting
            const endpoint = this.config.upload.url +
                '?upload' + Math.random();

            // build the XHR request
            const xhr = new XMLHttpRequest();

            // store the request in case we need to cancel it later
            this.test.requests[index] = xhr;

            // mark the request as an async GET on endpoint
            xhr.open('POST', endpoint, true);

            // disable compression
            xhr.setRequestHeader('Content-Encoding', 'identity');

            // initialize size loaded for this request
            let sizeLoaded = 0;

            // track request progress
            xhr.upload.onprogress = e => {
                // test is not running any more, exit
                if (!this.upload.running) {
                    resolve();
                    return;
                }

                // test is aborted, exit with status
                if (this.STATUS.ABORTED === this.test.status) {
                    reject({
                        status: this.STATUS.ABORTED
                    });
                    return;
                }

                // compute the size of the loaded chunk
                const loadDiff = e.loaded - sizeLoaded;

                // remember the the loaded size for next progress tacking
                sizeLoaded = e.loaded;

                // test is in grace time as long as we do not have a start date
                if (!this.upload.startDate) {
                    return;
                }

                // add the chunk size to the total loaded size
                this.upload.size += loadDiff;

                // compute stats
                this.processUploadSpeedResults();
            };

            // track request completion
            xhr.upload.onload = e => {
                // store current date and time
                const now = Date.now();

                // adjust chunk size of next loop if adaptive mode is enabled
                if (this.config.upload.adaptative) {
                    // loading was too fast? increase size
                    if (now - startDate < 500) {
                        size *= 2;
                    }
                    // loading was too slow? decrease size
                    if (now - startDate > 1000) {
                        size /= 2;
                    }
                }

                // clear XHR
                this.clearXMLHttpRequest(xhr);

                // prepare next loop
                this.testUploadSpeedXHR(size)
                    .then(resolve)
                    .catch(reject);
            };

            // track request errors
            xhr.upload.onerror = e => {
                console.log(arguments);

                if (this.config.ignoreErrors) {
                    // prepare next loop, but give it a delay to breathe
                    return this.testUploadSpeedXHR(size)
                        .then(resolve)
                        .catch(reject);
                }

                reject({
                    status: this.STATUS.FAILED,
                    error: 'test failed',
                });
            };

            // delay request dispatching as configured
            this.scope.setTimeout(
                () => {
                    xhr.send(this.upload.test.data);
                },
                delay
            );
        });
    }

    /**
     *
     *
     * @param {any} test
     */
    processUploadSpeedResults() {
        // compute test durations
        const durationFromInit = (Date.now() - this.upload.initDate) / 1000;
        const durationFromStart = (Date.now() - this.upload.startDate) / 1000;

        // compute progress
        const progress = durationFromInit / this.config.upload.duration;

        // compute bandwidth
        const {
            bitBandwidth: bandwidth
        } = this.computeBandwidth(this.upload.size, durationFromStart);

        // store results
        this.test.results.upload = {
            speed: +bandwidth.toFixed(2),
            progress: progress,
        };
    }

    /**
     *
     *
     * @param {any} size
     * @param {any} duration
     * @returns
     */
    computeBandwidth(size, duration) {
        // bandwidth is data volume over time
        const byteBandwidth = size / duration;
        // there is 8 bits in a byte
        const bitBandwidth = 8 * byteBandwidth;

        // return both values
        return {
            byteBandwidth: byteBandwidth,
            bitBandwidth: bitBandwidth,
        };
    }

    /**
     *
     *
     * @returns
     */
    run() {
        // only one test at a time
        if (this.test.running) {
            // Handle running satus and advertise it
            return new Promise((resolve, reject) => {
                reject({
                    status: this.test.status,
                    error: 'Stop the current test before starting another one.',
                });
            });
        }

        // prepare test data
        // this.config = JSON.parse(JSON.stringify(this.defaultConfig));
        this.test = {
            running: true,
            date: new Date().toJSON(),
            status: this.STATUS.STARTING,
            step: null,
            error: null,
            data: [],
            requests: [],
            results: {
                latency: null,
                download: null,
                upload: null,
            },
        };

        // run tests one after another
        this.test.status = this.STATUS.RUNNING;
        this.test.step = this.STEP.IP;
        return this.testIP()
            .then(() => {
                this.test.step = this.STEP.LATENCY;
                return this.testLatency();
            })
            .then(() => {
                this.test.step = this.STEP.DOWNLOAD;
                return this.testDownloadSpeed();
            })
            .then(() => {
                this.test.step = this.STEP.UPLOAD;
                return this.testUploadSpeed();
            })
            .then(() => {
                this.test.status = this.STATUS.DONE;
            })
            .catch(reason => {
                this.test.status = reason.status;
                this.test.error = reason.error;
            })
            .then(() => {
                // test is finished and not running anymore
                this.test.running = false;
                this.test.step = null;

                // clear any remaining request
                this.clearRequests(this.test.requests);

                // handle FAILED and ABORTED status
                if (this.STATUS.DONE !== this.test.status) {
                    throw ({
                        status: this.test.status,
                        error: this.test.error,
                    });
                }
            });
    }

    /**
     *
     *
     */
    abort() {
        this.test.status = this.STATUS.ABORTED;

        // test is canceled and not running anymore
        this.test.running = false;

        // clear any remaining request
        this.clearRequests(this.test.requests);
    }
}

new SpeedTestWorker(self);
