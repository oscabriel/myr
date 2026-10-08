// Nothing here is state at module scope: the rule reports none of it.
declare let injected: string;

const limit = 10;

export const counter = () => {
  let count = 0;

  return () => {
    count += 1;

    return count <= limit ? injected : "";
  };
};

export function hoisted() {
  var local = limit;

  return local;
}
