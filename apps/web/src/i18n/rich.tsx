import { Fragment } from "react";

// Like fmt(), but placeholders can be React nodes (e.g. a <strong> email).
export function rich(s: string, vars: Record<string, React.ReactNode>): React.ReactNode {
  return s.split(/(\{\w+\})/).map((part, i) => {
    const k = part.match(/^\{(\w+)\}$/)?.[1];
    return <Fragment key={i}>{k && k in vars ? vars[k] : part}</Fragment>;
  });
}
