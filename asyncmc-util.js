const AsyncM = require('asyncm');

exports.inject = function(AsyncCoroutine){

var AsyncCoroutineValue = AsyncCoroutine.Value;

AsyncCoroutine.ManualStream = ManualStream;

function ManualStream(options) {
	var self = this;

	var onFirstRun = options && options.onFirstRun,
	    onRequestValue = options && options.onRequestValue;

	var nextResults = [];

	let syncData = null;

	this.feed = function(value, error) {
		if (!nextResults) {
			console.error('Stream is ended');
			return;
		}

		if (syncData && !syncData.isFeeded) {
			syncData.isFeeded = true;
			syncData.feedValue = value;
		}

		var count = nextResults.length;

		while (count > 0) {
			var handler = nextResults.shift();

			handler(false, value, error);

			count--;
		}

		if (error) {
			nextResults = null;
		}
	};

	this.end = function() {
		var oldResults = nextResults;

		nextResults = null;

		oldResults.forEach(function(f) {
			f(true);
		});
	};

	this.getAsyncCoroutine = function() {
		var cor = new AsyncCoroutine(function() {
			return AsyncM.create(function(onResult, onError) {
				if (!nextResults) {
					onResult(null);
					return;
				}

				if (syncData) {
					syncData.onResult = onResult;
				} else {
					if (onRequestValue) {
						syncData = {
							onResult: onResult,
							isFeeded: false,
							feedValue: null
						};

						let lastLoopOnResult;

						while (true) {
							let onSyncResult = syncData.onResult;
							if (!onSyncResult) break;

							syncData.onResult = null;
							lastLoopOnResult = onSyncResult;

							onRequestValue(self);

							if (syncData.isFeeded) {
								lastLoopOnResult = null;

								syncData.isFeeded = false;

								onSyncResult(new AsyncCoroutineValue(syncData.feedValue, cor));
							}

							if (!nextResults) {
								lastLoopOnResult = null;

								onSyncResult(null);
								break;
							}
						}

						if (lastLoopOnResult) {
							nextResults.push(function(isEnd, value, error) {
								if (error) { onError(error); return; };

								if (isEnd) lastLoopOnResult(null);
								else lastLoopOnResult(new AsyncCoroutineValue(value, cor));
							});
						}

						syncData = null;
					} else {
						nextResults.push(function(isEnd, value, error) {
							if (error) { onError(error); return; };

							if (isEnd) onResult(null);
							else onResult(new AsyncCoroutineValue(value, cor));
						});
					}
				}
			});
		});

		var firstCor = new AsyncCoroutine(function() {
			return AsyncM.create(function(onResult) {
				if (!nextResults) {
					onResult(null);
					return;
				}

				nextResults.push(function(isEnd, value, error) {
					if (error) { onError(error); return; };

					if (isEnd) onResult(null);
					else onResult(new AsyncCoroutineValue(value, cor));
				});

				if (onFirstRun) onFirstRun(self);
				if (onRequestValue) onRequestValue(self);
			});
		});

		return firstCor;
	};
}

AsyncCoroutine.forEachSync = function(stream, fun) {
	function go(stream) {
		return stream.next().result(cor => {
			if (!cor) return AsyncM.result();

			let value = cor.value;

			let m = fun(value);

			return m.result(() => {
				if (!cor.next) return AsyncM.result();

				return go(cor.next);
			});
		});
	}
};

AsyncCoroutine.intervals = function(start, end, step) {
	return new AsyncCoroutine(generator.bind(null, start));

	function generator(x) {
		var finish = x + step;

		if (start > end) return AsyncM.result(null);

		if (finish >= end) {
			let interval = {
				start: x,
				end: end
			};

			return AsyncM.result(new AsyncCoroutineValue(interval, null));
		} else {
			let interval = {
				start: x,
				end: finish
			};

			return AsyncM.result(new AsyncCoroutineValue(interval, new AsyncCoroutine(generator.bind(null, finish))));
		}
	}
};

};