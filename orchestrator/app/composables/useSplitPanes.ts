import type { Tab, TabType, PaneNode, PaneLeafNode, PaneContainerNode, SplitDirection } from '~/types';

let _nextNodeId = 0;
function generateNodeId(): string {
  return `node-${++_nextNodeId}-${Date.now().toString(36)}`;
}

const MIN_FRACTION = 0.15;

// --- Type guards ---

function isLeaf(node: PaneNode): node is PaneLeafNode {
  return 'tabs' in node;
}

function isContainer(node: PaneNode): node is PaneContainerNode {
  return 'direction' in node && 'children' in node;
}

// --- Tree helpers ---

function findNode(root: PaneNode, nodeId: string): PaneNode | null {
  if (root.id === nodeId) return root;
  if (isContainer(root)) {
    for (const child of root.children) {
      const found = findNode(child, nodeId);
      if (found) return found;
    }
  }
  return null;
}

function findParent(root: PaneNode, nodeId: string): [PaneContainerNode, number] | null {
  if (isContainer(root)) {
    for (let i = 0; i < root.children.length; i++) {
      const child = root.children[i]!;
      if (child.id === nodeId) return [root, i];
      const found = findParent(child, nodeId);
      if (found) return found;
    }
  }
  return null;
}

function findLeafForTab(root: PaneNode, tabId: string): PaneLeafNode | null {
  if (isLeaf(root)) {
    return root.tabs.some((t) => t.id === tabId) ? root : null;
  }
  for (const child of root.children) {
    const found = findLeafForTab(child, tabId);
    if (found) return found;
  }
  return null;
}

function collectLeaves(root: PaneNode | null): PaneLeafNode[] {
  if (!root) return [];
  if (isLeaf(root)) return [root];
  const leaves: PaneLeafNode[] = [];
  for (const child of root.children) {
    leaves.push(...collectLeaves(child));
  }
  return leaves;
}

function redistributeSiblings(parent: PaneContainerNode) {
  const count = parent.children.length;
  if (count === 0) return;
  const fraction = 1 / count;
  for (const child of parent.children) {
    child.sizeFraction = fraction;
  }
}

/**
 * If a container has only one child, replace it with that child.
 * Returns the (possibly replaced) node.
 */
function collapseIfSingleChild(node: PaneNode): PaneNode {
  if (isLeaf(node)) return node;

  // Recursively collapse children first
  for (let i = 0; i < node.children.length; i++) {
    node.children[i] = collapseIfSingleChild(node.children[i]!);
  }

  if (node.children.length === 1) {
    const child = node.children[0]!;
    child.sizeFraction = node.sizeFraction;
    return child;
  }

  return node;
}

/**
 * Remove a leaf from the tree by its id. Returns the updated root (or null if tree is now empty).
 */
function removeLeafFromTree(root: PaneNode, leafId: string): PaneNode | null {
  if (isLeaf(root)) {
    return root.id === leafId ? null : root;
  }

  const idx = root.children.findIndex((c) => c.id === leafId);
  if (idx !== -1) {
    root.children.splice(idx, 1);
    redistributeSiblings(root);
    if (root.children.length === 0) return null;
    return collapseIfSingleChild(root);
  }

  // Recurse into container children
  for (let i = 0; i < root.children.length; i++) {
    const child = root.children[i]!;
    if (isContainer(child)) {
      const result = removeLeafFromTree(child, leafId);
      if (result === null) {
        root.children.splice(i, 1);
        redistributeSiblings(root);
        if (root.children.length === 0) return null;
        return collapseIfSingleChild(root);
      }
      if (result !== child) {
        result.sizeFraction = child.sizeFraction;
        root.children[i] = result;
      }
    }
  }

  return collapseIfSingleChild(root);
}

// --- Module state ---

const rootNode = ref<PaneNode | null>(null);
const focusedNodeId = ref<string | null>(null);

export function useSplitPanes() {
  // --- Derived state ---

  const paneGroups = computed(() => collectLeaves(rootNode.value));

  const focusedGroup = computed(() =>
    paneGroups.value.find((g) => g.id === focusedNodeId.value) ?? null,
  );

  const tabs = computed(() => paneGroups.value.flatMap((g) => g.tabs));

  // --- Helpers ---

  function makeTabId(containerId: string, type: TabType): string {
    return `${containerId}:${type}`;
  }

  function findGroupForTab(tabId: string): PaneLeafNode | undefined {
    if (!rootNode.value) return undefined;
    return findLeafForTab(rootNode.value, tabId) ?? undefined;
  }

  function updateFocusAfterRemoval(removedNodeId: string) {
    if (focusedNodeId.value !== removedNodeId) return;
    const leaves = paneGroups.value;
    focusedNodeId.value = leaves.length > 0 ? leaves[0]!.id : null;
  }

  function removeLeafIfEmpty(leafId: string) {
    if (!rootNode.value) return;
    const node = findNode(rootNode.value, leafId);
    if (!node || !isLeaf(node) || node.tabs.length > 0) return;

    const result = removeLeafFromTree(rootNode.value, leafId);
    rootNode.value = result;
    updateFocusAfterRemoval(leafId);
  }

  // --- Public API ---

  function focusGroup(nodeId: string) {
    focusedNodeId.value = nodeId;
  }

  function openTab(containerId: string, containerName: string, type: TabType, targetNodeId?: string) {
    const tabId = makeTabId(containerId, type);

    // If tab already exists, focus it
    const existingLeaf = findGroupForTab(tabId);
    if (existingLeaf) {
      existingLeaf.activeTabId = tabId;
      focusedNodeId.value = existingLeaf.id;
      return;
    }

    const tab: Tab = { id: tabId, containerId, containerName, type };

    // Find target leaf
    let leaf: PaneLeafNode | undefined;
    if (targetNodeId && rootNode.value) {
      const node = findNode(rootNode.value, targetNodeId);
      if (node && isLeaf(node)) leaf = node;
    }
    if (!leaf) {
      leaf = focusedGroup.value ?? paneGroups.value[0];
    }

    // No tree — create root leaf
    if (!leaf) {
      const newLeaf: PaneLeafNode = {
        id: generateNodeId(),
        tabs: [tab],
        activeTabId: tabId,
        sizeFraction: 1,
      };
      rootNode.value = newLeaf;
      focusedNodeId.value = newLeaf.id;
      return;
    }

    leaf.tabs.push(tab);
    leaf.activeTabId = tabId;
    focusedNodeId.value = leaf.id;
  }

  function closeTab(tabId: string) {
    const leaf = findGroupForTab(tabId);
    if (!leaf) return;

    const idx = leaf.tabs.findIndex((t) => t.id === tabId);
    if (idx === -1) return;

    leaf.tabs.splice(idx, 1);

    if (leaf.activeTabId === tabId) {
      if (leaf.tabs.length === 0) {
        leaf.activeTabId = null;
      } else {
        const next = Math.min(idx, leaf.tabs.length - 1);
        leaf.activeTabId = leaf.tabs[next]!.id;
      }
    }

    removeLeafIfEmpty(leaf.id);
  }

  function closeTabsForContainer(containerId: string) {
    const tabIds: string[] = [];
    for (const leaf of paneGroups.value) {
      for (const tab of leaf.tabs) {
        if (tab.containerId === containerId) {
          tabIds.push(tab.id);
        }
      }
    }
    for (const id of tabIds) {
      closeTab(id);
    }
  }

  function activateTab(tabId: string, nodeId: string) {
    if (!rootNode.value) return;
    const node = findNode(rootNode.value, nodeId);
    if (!node || !isLeaf(node)) return;
    node.activeTabId = tabId;
    focusedNodeId.value = nodeId;
  }

  function moveTab(tabId: string, targetNodeId: string, insertIndex?: number) {
    if (!rootNode.value) return;

    const sourceLeaf = findGroupForTab(tabId);
    if (!sourceLeaf) return;

    const targetNode = findNode(rootNode.value, targetNodeId);
    if (!targetNode || !isLeaf(targetNode)) return;

    // Same leaf reorder
    if (sourceLeaf.id === targetNode.id) {
      const fromIdx = sourceLeaf.tabs.findIndex((t) => t.id === tabId);
      if (fromIdx === -1) return;
      if (insertIndex !== undefined && insertIndex !== fromIdx) {
        const [movedTab] = sourceLeaf.tabs.splice(fromIdx, 1);
        const adjustedIdx = insertIndex > fromIdx ? insertIndex - 1 : insertIndex;
        sourceLeaf.tabs.splice(adjustedIdx, 0, movedTab!);
      }
      sourceLeaf.activeTabId = tabId;
      return;
    }

    // Cross-leaf move
    const tabIdx = sourceLeaf.tabs.findIndex((t) => t.id === tabId);
    if (tabIdx === -1) return;
    const [movedTab] = sourceLeaf.tabs.splice(tabIdx, 1);
    if (!movedTab) return;

    // Adjust source leaf's active tab
    if (sourceLeaf.activeTabId === tabId) {
      if (sourceLeaf.tabs.length === 0) {
        sourceLeaf.activeTabId = null;
      } else {
        const next = Math.min(tabIdx, sourceLeaf.tabs.length - 1);
        sourceLeaf.activeTabId = sourceLeaf.tabs[next]!.id;
      }
    }

    // Insert into target
    if (insertIndex !== undefined) {
      targetNode.tabs.splice(insertIndex, 0, movedTab);
    } else {
      targetNode.tabs.push(movedTab);
    }
    targetNode.activeTabId = tabId;
    focusedNodeId.value = targetNode.id;

    removeLeafIfEmpty(sourceLeaf.id);
  }

  function splitWithTab(tabId: string, direction: 'left' | 'right' | 'top' | 'bottom', refNodeId: string) {
    if (!rootNode.value) return;

    const sourceLeaf = findGroupForTab(tabId);
    if (!sourceLeaf) return;

    // Determine the split direction
    const splitDir: SplitDirection = (direction === 'left' || direction === 'right') ? 'horizontal' : 'vertical';
    const insertBefore = direction === 'left' || direction === 'top';

    const refNode = findNode(rootNode.value, refNodeId);
    if (!refNode) return;

    // Remove tab from source
    const tabIdx = sourceLeaf.tabs.findIndex((t) => t.id === tabId);
    if (tabIdx === -1) return;
    const [movedTab] = sourceLeaf.tabs.splice(tabIdx, 1);
    if (!movedTab) return;

    // Adjust source leaf's active tab
    if (sourceLeaf.activeTabId === tabId) {
      if (sourceLeaf.tabs.length === 0) {
        sourceLeaf.activeTabId = null;
      } else {
        const next = Math.min(tabIdx, sourceLeaf.tabs.length - 1);
        sourceLeaf.activeTabId = sourceLeaf.tabs[next]!.id;
      }
    }

    // Clean up empty source before splitting
    const sourceId = sourceLeaf.id;
    const sourceWasEmpty = sourceLeaf.tabs.length === 0;
    if (sourceWasEmpty) {
      const result = removeLeafFromTree(rootNode.value, sourceId);
      rootNode.value = result;
      updateFocusAfterRemoval(sourceId);
    }

    // If tree was completely emptied, just create a new root leaf
    if (!rootNode.value) {
      const newLeaf: PaneLeafNode = {
        id: generateNodeId(),
        tabs: [movedTab],
        activeTabId: tabId,
        sizeFraction: 1,
      };
      rootNode.value = newLeaf;
      focusedNodeId.value = newLeaf.id;
      return;
    }

    // Create the new leaf for the dragged tab
    const newLeaf: PaneLeafNode = {
      id: generateNodeId(),
      tabs: [movedTab],
      activeTabId: tabId,
      sizeFraction: 0.5,
    };

    // Re-find reference node (it may have shifted after source removal)
    const currentRefNode = findNode(rootNode.value, refNodeId);
    if (!currentRefNode) {
      // Reference was removed (it was the source) — just add as root
      rootNode.value = newLeaf;
      newLeaf.sizeFraction = 1;
      focusedNodeId.value = newLeaf.id;
      return;
    }

    // Find parent of reference node
    const parentResult = findParent(rootNode.value, refNodeId);

    if (parentResult && parentResult[0].direction === splitDir) {
      // Case 1: Parent already splits in same direction — insert as sibling
      const [parent, childIdx] = parentResult;
      const insertIdx = insertBefore ? childIdx : childIdx + 1;

      // Check min fraction
      const futureCount = parent.children.length + 1;
      if (1 / futureCount < MIN_FRACTION) {
        // Undo: put tab back
        sourceLeaf.tabs.splice(tabIdx, 0, movedTab);
        if (sourceLeaf.activeTabId === null) sourceLeaf.activeTabId = tabId;
        return;
      }

      parent.children.splice(insertIdx, 0, newLeaf);
      redistributeSiblings(parent);
    } else if (!parentResult) {
      // Case 2: Reference is root — wrap root in a container
      if (isLeaf(rootNode.value) && rootNode.value.id === refNodeId) {
        const existingLeaf = rootNode.value;
        existingLeaf.sizeFraction = 0.5;
        newLeaf.sizeFraction = 0.5;

        const children = insertBefore ? [newLeaf, existingLeaf] : [existingLeaf, newLeaf];
        rootNode.value = {
          id: generateNodeId(),
          sizeFraction: 1,
          direction: splitDir,
          children,
        };
      } else if (isContainer(rootNode.value) && rootNode.value.id === refNodeId) {
        const existingRoot = rootNode.value;
        existingRoot.sizeFraction = 0.5;
        newLeaf.sizeFraction = 0.5;

        const children = insertBefore ? [newLeaf, existingRoot] : [existingRoot, newLeaf];
        rootNode.value = {
          id: generateNodeId(),
          sizeFraction: 1,
          direction: splitDir,
          children,
        };
      }
    } else {
      // Case 3: Reference node becomes a container with 2 children
      const [parent, childIdx] = parentResult;

      const existingNodeData = currentRefNode;
      const clonedNode: PaneNode = isLeaf(existingNodeData)
        ? {
            id: generateNodeId(),
            sizeFraction: 0.5,
            tabs: [...existingNodeData.tabs],
            activeTabId: existingNodeData.activeTabId,
          }
        : {
            ...existingNodeData,
            id: generateNodeId(),
            sizeFraction: 0.5,
          };

      newLeaf.sizeFraction = 0.5;

      const children = insertBefore ? [newLeaf, clonedNode] : [clonedNode, newLeaf];
      const newContainer: PaneContainerNode = {
        id: existingNodeData.id,
        sizeFraction: existingNodeData.sizeFraction,
        direction: splitDir,
        children,
      };

      parent.children[childIdx] = newContainer;

      // Update focused node if it pointed to the old node
      if (focusedNodeId.value === existingNodeData.id) {
        focusedNodeId.value = clonedNode.id;
      }
    }

    focusedNodeId.value = newLeaf.id;
  }

  function resizeNodes(firstNodeId: string, deltaFraction: number) {
    if (!rootNode.value) return;

    const parentResult = findParent(rootNode.value, firstNodeId);
    if (!parentResult) return;

    const [parent, childIdx] = parentResult;
    if (childIdx >= parent.children.length - 1) return;

    const first = parent.children[childIdx]!;
    const second = parent.children[childIdx + 1]!;

    let newFirst = first.sizeFraction + deltaFraction;
    let newSecond = second.sizeFraction - deltaFraction;

    if (newFirst < MIN_FRACTION) {
      newSecond += newFirst - MIN_FRACTION;
      newFirst = MIN_FRACTION;
    }
    if (newSecond < MIN_FRACTION) {
      newFirst += newSecond - MIN_FRACTION;
      newSecond = MIN_FRACTION;
    }

    first.sizeFraction = newFirst;
    second.sizeFraction = newSecond;
  }

  const activeTabId = computed(() => focusedGroup.value?.activeTabId ?? null);

  return {
    rootNode,
    focusedNodeId,
    activateTab,
    splitWithTab,
    resizeNodes,
    focusGroup,
    moveTab,
    tabs,
    activeTabId,
    openTab,
    closeTab,
    closeTabsForContainer,
  };
}

// Re-export type guards for use in components
export { isLeaf, isContainer };
