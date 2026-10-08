// Each binding below is state at module scope: the rule reports all three.
let requests = 0;

var cache = new Map<string, string>();

if (requests === 0) {
  // A `var` in a block still hoists to the module.
  var warmed = true;
}

export const count = () => {
  requests += 1;
  cache.set("last", String(requests));

  return warmed;
};
