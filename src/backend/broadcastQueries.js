function stringify(obj, replacer, spaces, cycleReplacer) {
  return JSON.stringify(obj, serializer(replacer, cycleReplacer), spaces);
}

function serializer(replacer, cycleReplacer) {
  var stack = [],
    keys = [];

  if (cycleReplacer == null)
    cycleReplacer = function(key, value) {
      if (stack[0] === value) return "[Circular ~]";
      return (
        "[Circular ~." + keys.slice(0, stack.indexOf(value)).join(".") + "]"
      );
    };

  return function(key, value) {
    if (stack.length > 0) {
      var thisPos = stack.indexOf(this);
      ~thisPos ? stack.splice(thisPos + 1) : stack.push(this);
      ~thisPos ? keys.splice(thisPos, Infinity, key) : keys.push(key);
      if (~stack.indexOf(value)) value = cycleReplacer.call(this, key, value);
    } else stack.push(value);

    return replacer == null ? value : replacer.call(this, key, value);
  };
}

export const initBroadCastEvents = (hook, bridge) => {
  // Counters for diagnostics
  let counter = 0;

  // Next broadcast to be sent
  let enqueued = null;

  // Whether backend is ready for another broadcast
  let acknowledged = true;

  // Threshold for warning about state size in Megabytes
  let warnMB = 10;

  // Minimize impact to webpage. Serializing large state could cause jank
  function scheduleBroadcast() {
    acknowledged = false;
    requestIdleCallback(sendBroadcast, { timeout: 120 /*max 2min*/ });
  }

  // Send the Apollo broadcast to the devtools
  function sendBroadcast() {
    const msg = stringify(enqueued);
    bridge.send("broadcast:new", msg);
    enqueued = null;

    if (msg.length > warnMB * 1000000) {
      const currentMB = msg.length / 1000000;
      console.warn(
        `Apollo DevTools serialized state is ${currentMB.toFixed(1)} MB. ` +
        "This may cause performance degradation.",
      );
      // Warn again if it doubles
      warnMB = currentMB * 2;
    }
  }

  let logger = ({
    state: { queries, mutations },
    dataWithOptimisticResults: inspector,
  }) => {
    const client = hook.ApolloClient;

    counter++;
    enqueued = {
      counter,
      queries: JSON.parse(
        stringify(Object.fromEntries(client.queryManager.queries)),
      ),
      mutations,
      inspector,
    };
    if (acknowledged) {
      scheduleBroadcast();
    }
  };

  // The backend has acknowledged receipt of a broadcast
  bridge.on("broadcast:ack", data => {
    acknowledged = true;
    if (enqueued) {
      scheduleBroadcast();
    }
  });

  bridge.on("panel:ready", () => {
    const client = hook.ApolloClient;
    const initial = {
      queries: client.queryManager
        ? JSON.parse(stringify(Object.fromEntries(client.queryManager.queries)))
        : {},
      mutations: client.queryManager
        ? client.queryManager.mutationStore.getStore()
        : {},
      inspector: client.cache.extract(true),
    };
    bridge.send("broadcast:new", stringify(initial));
  });

  hook.ApolloClient.__actionHookForDevTools(logger);
};
