/* globals window:false, M:false, AsyncM:false */

(function(M){

let utilFuns = require('./asyncmc-util.js');

if (typeof module !== 'undefined') {
	module.exports = AsyncCoroutine;
} else {
	window.AsyncCoroutine = AsyncCoroutine;
}

// TODO: eliminate `arguments`, pass only one argument

function AsyncCoroutineValue(value, asyncCoroutine) {
	if (!(this instanceof AsyncCoroutineValue)) throw new Error();

	this.value = value;
	this.next = asyncCoroutine;
}
function AsyncCoroutine(run) {
	let _run = run;
	run = function() {
		let m = _run.apply(null, arguments);
		return m.result(cor => {
			if (!cor) return;
			if (cor.next) return;

			return M.result(new AsyncCoroutineValue(cor.value, AsyncCoroutine.empty()));
		});
	};

	this.next = run;
	// When stream is over, continues stream with f(x):Stream,
	// where `x` is last stream value,
	// and with g():Stream (or f():Stream), if no last value
	this.continueWith = function(f, g) {
		return new AsyncCoroutine(function() {
			return run.apply(null, arguments).result(function(corValue) {
				if (corValue) {
					if (corValue.next) {
						this.contResult(new AsyncCoroutineValue(corValue.value, corValue.next.continueWith(f, g)));
					} else {
						return f(corValue.value).result(gen => new AsyncCoroutineValue(corValue.value, gen));
					}
				} else {
					return (g || f)().result(function(gen) {
						if (gen) return gen.next();
						else this.contResult(null);
					});
				}
			});
		});
	};
	// Replaces every stream value `x` with f(x)
	this.mapValue = function(f, state) {
		return new AsyncCoroutine(function() {
			return run.apply(null, arguments).result(function(corValue) {
				if (corValue) {
					let r = f(corValue.value, state);

					let result, newState;

					if (r instanceof AsyncCoroutine.MapValue) {
						result = r.result;
						newState = r.newState;
					} else {
						result = r;
						newState = state;
					}

					this.contResult(new AsyncCoroutineValue(result, corValue.next && corValue.next.mapValue(f, newState)));
				} else {
					this.contResult(null);
				}
			});
		});
	};
	// gen: AsyncCoroutine<null + {value: T, args: arguments}, (<args> + AsyncCoroutine)>
	this.transform = function(gen) {
		return new AsyncCoroutine(function() {
			return run.apply(null, arguments).result(transforming.bind(null, gen, arguments));

			function transforming(gen, args, corValue) {
				if (corValue) {
					let m = gen.next({value: corValue.value, args: args});

					return m.result(function(transformerCorValue) {
						if (transformerCorValue) {
							let coroutineOrArgs = transformerCorValue.value,
							    transformer = transformerCorValue.next;

							if (coroutineOrArgs instanceof AsyncCoroutine) {
								return coroutineOrArgs.continueWith(function() {
									if (transformer) {
										return M.result(corValue.next && corValue.next.transform(transformer));
									} else {
										// end of stream
										return M.result(null);
									}
								}).next();
							} else {
								if (corValue.next) {
									let m = coroutineOrArgs && coroutineOrArgs.length ?
									          corValue.next.next.apply(null, coroutineOrArgs)
									        : corValue.next.next();

									return m.result(transforming.bind(null, transformer, coroutineOrArgs));
								} else {
									return gen.next(null);
								}
							}
						} else {
							// cancellation of transforming
							this.contResult(corValue);
						}
					});
				} else {
					return gen.next(null);
				}
			}
		});
	};
	// Removes values from stream if !filter(x)
	this.filterValues = function(filter) {
		var transformator = new AsyncCoroutine(function(maybeValue) {
			if (!maybeValue) return null;

			let value = maybeValue.value;

			if (filter(value)) {
				return M.result(new AsyncCoroutineValue(AsyncCoroutine.single(value), transformator));
			} else {
				return M.result(new AsyncCoroutineValue(null, transformator));
			}
		});

		return this.transform(transformator);
	};
	this.filterMapValues = function(filterMap) {
		var transformator = new AsyncCoroutine(function(maybeValue) {
			if (!maybeValue) return null;

			let value = maybeValue.value,
			    maybeMap = filterMap(value);

			if (maybeMap instanceof AsyncCoroutine.FilterMapValue) {
				return M.result(new AsyncCoroutineValue(AsyncCoroutine.single(maybeMap.value), transformator));
			} else {
				return M.result(new AsyncCoroutineValue(null, transformator));
			}
		});

		return this.transform(transformator);
	};
	// Replaces every value `x` with generator from map(x): Async<Stream>
	this.mapValuesM = function(map) {
		var transformator = new AsyncCoroutine(function(maybeValue) {
			if (!maybeValue) return null;

			let value = maybeValue.value;

			return map(value).result(function(stream) {
				return new AsyncCoroutineValue(stream, transformator);
			});
		});

		return this.transform(transformator);
	};
	// Returns Async<R>, reducer: (R, T) → R, initState: R
	this.reduceStream = function(reducer, initState) {
		function handleStream(state, cor) {
			if (!cor) return M.result(state);

			let newState = reducer(state, cor.value);

			if (cor.next) {
				return cor.next.next().result(handleStream.bind(null, newState));
			} else {
				return M.result(newState);
			}
		}

		return this.next().result(handleStream.bind(null, initState));
	};
	this.forEach = function(fun) {
		function handleStream(cor) {
			if (!cor) return M.result();

			if (cor.next) {
				fun(cor.value);
				return cor.next.next().result(handleStream);
			} else {
				return M.result();
			}
		}

		return this.next().result(handleStream);
	};
	this.forEachUntil = function(fun) {
		function handleStream(cor) {
			if (!cor) return M.result({ rest: null, value: null });

			if (cor.next) {
				let found = fun(cor.value);

				if (found) {
					return M.result({
						rest: cor.next,
						value: found,
					});
				} else {
					return cor.next.next().result(handleStream);
				}
			} else {
				return M.result({
					rest: null,
					value: null,
				});
			}
		}

		return this.next().result(handleStream);
	};
	this.forEachM = function(fun) {
		function handleStream(cor) {
			if (!cor) return M.result();

			if (cor.next) {
				let m = fun(cor.value);
				if (!M.isM(m)) m = M.result(m);
				return m.result(() => {
					return cor.next.next().result(handleStream);
				});
			} else {
				return M.result();
			}
		}

		return this.next().result(handleStream);
	};
	// Returns Async<E, R>, reducer: (R, T) → Async<E, R>, initState: R
	this.reduceStreamM = function(reducer, initState) {
		function handleStream(state, cor) {
			if (!cor) return M.result(state);

			let m = reducer(state, cor.value);

			if (m instanceof M) {
				return m.result(continueWithNewState);
			} else {
				return continueWithNewState(m);
			}

			function continueWithNewState(newState) {
				if (cor.next) {
					return cor.next.next().result(handleStream.bind(null, newState));
				} else {
					return M.result(newState);
				}
			}
		}

		return this.next().result(handleStream.bind(null, initState));
	};

	this.error = function(fun) {
		return wrap(run);

		function wrap(run) {
			return new AsyncCoroutine(function(arg) {
				return run(arg).next(transforming, onError);

				function transforming(cor) {
					if (!cor || !cor.next) return M.result();

					return M.result(new AsyncCoroutineValue(cor.value, wrap(cor.next.next)));
				}
				function onError(error, errorData) {
					// Should not return result
					return fun(error, errorData);
				}
			});
		}
	};
}
AsyncCoroutine.Value = AsyncCoroutineValue;

AsyncCoroutine.empty = function generatorEmpty() {
	return new AsyncCoroutine(function() { return M.result(null); });
};
AsyncCoroutine.single = function generatorSingle(x) {
	return new AsyncCoroutine(function() { return M.result(new AsyncCoroutineValue(x, null)); });
};
AsyncCoroutine.error = function generatorError(x) {
	return new AsyncCoroutine(function() { return M.error(x); });
};

AsyncCoroutine.fromArray = function generatorFromArray(array) {
	return new AsyncCoroutine(generator.bind(null, 0));

	function generator(i) {
		return M.result(i < array.length ? new AsyncCoroutineValue(array[i], new AsyncCoroutine(generator.bind(null, i + 1))) : null);
	}
};

AsyncCoroutine.MapValue = function(result, state) {
	this.result = result;
	this.state = state;
};
AsyncCoroutine.FilterMapValue = function(value) {
	this.value = value;
};

utilFuns.inject(AsyncCoroutine);

})(typeof AsyncM === 'undefined' ? require('asyncm') : AsyncM);
