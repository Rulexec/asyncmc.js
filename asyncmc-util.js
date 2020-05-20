const AsyncM = require('asyncm');

exports.inject = function(AsyncCoroutine){

AsyncCoroutine.CANCELLED = Symbol('cancelled');

var AsyncCoroutineValue = AsyncCoroutine.Value;

AsyncCoroutine.Stream = Stream;
AsyncCoroutine.SingleValueStream = SingleValueStream;

function Stream(options) {
	let onRequest = options && options.onRequest;
	let onHeadDropped = options && options.onHeadDropped;

	const self = this;

	let valuesHead = { value: null, next: null };
	let valuesEnd = valuesHead;

	let error;
	let isFinished = false;

	let valueWaiters = [];

	let valueRequestedRunning = null;

	function onNewValue() {
		let oldWaiters = valueWaiters;
		valueWaiters = [];

		oldWaiters.forEach(fun => { fun(); });
	}

	this.isFinished = () => isFinished || !!error;

	this.push = function(value) {
		if (isFinished || error) return;

		let newNode = {
			value,
			next: null,
		};

		valuesEnd.next = newNode;
		valuesEnd = newNode;

		onNewValue();
	};
	this.finish = function() {
		if (error) return;
		isFinished = true;
		onNewValue();

		cleanup();
	};
	this.error = function(err) {
		if (isFinished) return;
		error = err;
		onNewValue();

		cleanup();
	};

	this.getAsyncCoroutine = () => createAsyncCoroutine(valuesHead);

	function createAsyncCoroutine(node) {
		return new AsyncCoroutine(() => AsyncM.create((onResult, onError) => {
			setImmediate(() => handle());

			function handle() {
				let nextNode = node.next;

				if (nextNode) {
					if (valuesHead.next) {
						// Move head, new readers will not receive first item,
						// if they need history — they must do it explicit (or store reference to first coroutine)

						if (onHeadDropped) onHeadDropped(valuesHead.value);

						valuesHead = valuesHead.next;
					}

					let value = nextNode.value;

					onResult(new AsyncCoroutineValue(value, createAsyncCoroutine(nextNode)));
				} else if (error) {
					onError(error);
				} else if (isFinished) {
					onResult(null);
				} else {
					valueWaiters.push(handle);

					if (onRequest && !valueRequestedRunning) {
						callOnRequest();
					}
				}
			}
		}));
	}

	function callOnRequest() {
		let sync = true;

		while (true) {
			// eslint-disable-next-line no-loop-func
			valueRequestedRunning = onRequest.call(self).run(() => {
				if (sync) { sync = false; return; }

				if (valueWaiters.length) callOnRequest();
				else valueRequestedRunning = null;
			}, error => {
				self.error(error);
			});

			if (sync) {
				sync = false;
				break;
			}

			if (valueWaiters.length) sync = true;
			else { valueRequestedRunning = null; break; }
		}
	}

	function cleanup() {
		if (valueRequestedRunning) {
			valueRequestedRunning.cancel().run();
			valueRequestedRunning = null;
		}
	}
}

function SingleValueStream(value) {
	let error;
	let isFinished = false;

	let valueWaiters = [];

	function onNewValue() {
		let oldWaiters = valueWaiters;
		valueWaiters = [];

		oldWaiters.forEach(fun => { fun(); });
	}

	this.push = function(val) {
		if (isFinished || error) return;
		value = val;
		onNewValue();
	};
	this.finish = function() {
		if (error) return;
		isFinished = true;
		onNewValue();
	};
	this.error = function(err) {
		if (isFinished) return;
		error = err;
		onNewValue();
	};

	this.getAsyncCoroutine = () => createAsyncCoroutine(0);

	function createAsyncCoroutine() {
		return new AsyncCoroutine(() => AsyncM.create((onResult, onError) => {
			handle();

			function handle() {
				if (error) {
					onError(error);
				} else if (isFinished) {
					onResult(null);
				} else {
					onResult(new AsyncCoroutineValue(value, createWaitingCoroutine(value)));
				}
			}
		}));

		function createWaitingCoroutine(oldValue) {
			return new AsyncCoroutine(() => AsyncM.create((onResult, onError) => {
				handle();

				function handle() {
					if (error) {
						onError(error);
					} else if (isFinished) {
						onResult(null);
					} else {
						if (value !== oldValue) {
							onResult(new AsyncCoroutineValue(value, createWaitingCoroutine(value)));
						} else {
							valueWaiters.push(handle);
						}
					}
				}
			}));
		}
	}
}

AsyncCoroutine.fromList = function(list) {
	let index = 0;

	let stream = new Stream({
		onRequest() {
			if (index >= list.length) {
				stream.finish();
				return AsyncM.result();
			}

			let item = list[index];
			index++;

			stream.push(item);

			return AsyncM.result();
		},
	});

	return stream.getAsyncCoroutine();
};

AsyncCoroutine.fromM = function(m) {
	return new AsyncCoroutine(function() {
		let args = arguments;

		return m.result(cor => {
			return cor.next.apply(this, args);
		});
	});
};

/*AsyncCoroutine.forEachSync = function(stream, fun) {
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
};*/

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