// nav.js — shortest paths over world.js's waypoint graph. Breadth-first
// search from the goal node, cached per goal: a bot asks "which node do I
// walk to next to reach that site" and gets the next hop, so a whole team's
// routes cost a handful of searches a round, not per frame.

import { WORLD, nearestNode } from './world.js';

const routesTo = new Map(); // goalNode -> Int16Array of next hops

function routeTo(goal) {
  let route = routesTo.get(goal);
  if (route) return route;
  const nodes = WORLD.navNodes;
  const prev = new Int16Array(nodes.length).fill(-1);
  prev[goal] = goal;
  const queue = [goal];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    for (const next of nodes[cur].next) {
      if (prev[next] === -1) {
        prev[next] = cur;
        queue.push(next);
      }
    }
  }
  routesTo.set(goal, prev);
  return prev;
}

// The next world position to walk toward on the way to (tx, tz), or null
// when the straight line there is already walkable. `fromNode` lets a caller
// that just reached a node continue without re-searching.
export function nextStepToward(x, z, tx, tz, scratch) {
  const goalNode = nearestNode(tx, tz);
  const startNode = nearestNode(x, z);
  if (startNode === goalNode) return null;
  const route = routeTo(goalNode);
  const hop = route[startNode];
  if (hop === -1 || hop === undefined) return null;
  const node = WORLD.navNodes[hop];
  scratch.set(node.x, 0, node.z);
  return scratch;
}

// The node nearest a named place, used by the team plans in bots.js.
export function nodeNear(x, z) {
  return nearestNode(x, z);
}
