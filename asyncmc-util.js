const AsyncM = require('asyncm');

exports.inject = function(AsyncCoroutine){

var AsyncCoroutineValue = AsyncCoroutine.Value;

AsyncCoroutine.Stream = Stream;

function Stream(options) {
	let onRequest = options && options.onRequest;

	const self = this;

	let values = [];
	let error;
	let isFinished = false;

	let valueWaiters = [];

	let valueRequestedRunning = null;

	function onNewValue() {
		let oldWaiters = valueWaiters;
		valueWaiters = [];

		oldWaiters.forEach(fun => { fun(); });
	}

	this.push = function(value) {
		if (isFinished || error) throw new Error('already_finished');
		values.push(value);
		onNewValue();
	};
	this.finish = function() {
		if (error) throw new Error('already_finished');
		isFinished = true;
		onNewValue();
	};
	this.error = function(err) {
		if (isFinished) throw new Error('already_finished');
		error = err;
		onNewValue();
	};

	this.getAsyncCoroutine = () => createAsyncCoroutine(0);

	function createAsyncCoroutine(index) {
		return new AsyncCoroutine(() => AsyncM.create((onResult, onError) => {
			handle();

			function handle() {
				if (index < values.length) {
					let value = values[index];

					onResult(new AsyncCoroutineValue(value, createAsyncCoroutine(index + 1)));
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
			valueRequestedRunning = true;

			onRequest.call(self).run(() => {
				if (sync) { sync = false; return; }

				if (valueWaiters.length) callOnRequest();
				else valueRequestedRunning = false;
			}, error => {
				self.error(error);
			});

			if (sync) {
				sync = false;
				break;
			}

			if (valueWaiters.length) sync = true;
			else { valueRequestedRunning = false; break; }
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