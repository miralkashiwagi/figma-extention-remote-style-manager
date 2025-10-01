interface RemoteStyleInfo {
    styleId: string;
    styleName: string;
    styleType: 'FILL' | 'TEXT' | 'EFFECT' | 'GRID';
    layers: Array<{
        id: string;
        name: string;
        type: string;
    }>;
}

interface LocalStyleInfo {
    id: string;
    name: string;
    type: 'FILL' | 'TEXT' | 'EFFECT' | 'GRID';
}

// This shows the HTML page in "ui.html".

figma.showUI(__html__, { width: 600, height: 700 });

// リモートスタイルが適用されているレイヤーを検索
async function findLayersWithRemoteStyles(): Promise<RemoteStyleInfo[]> {
    const remoteStylesMap = new Map<string, RemoteStyleInfo>();

    async function traverse(node: SceneNode) {
        // Fill/Stroke styles
        if ('fillStyleId' in node && node.fillStyleId) {
            await checkStyle(node, node.fillStyleId, 'FILL');
        }
        if ('strokeStyleId' in node && node.strokeStyleId) {
            await checkStyle(node, node.strokeStyleId, 'FILL');
        }

        // Text styles
        if ('textStyleId' in node && node.textStyleId) {
            await checkStyle(node, node.textStyleId, 'TEXT');
        }

        // Effect styles
        if ('effectStyleId' in node && node.effectStyleId) {
            await checkStyle(node, node.effectStyleId, 'EFFECT');
        }

        // Grid styles
        if ('gridStyleId' in node && node.gridStyleId) {
            await checkStyle(node, node.gridStyleId, 'GRID');
        }

        if ('children' in node) {
            for (const child of node.children) {
                await traverse(child);
            }
        }
    }

    async function checkStyle(node: SceneNode, styleId: string | symbol, styleType: 'FILL' | 'TEXT' | 'EFFECT' | 'GRID') {
        if (typeof styleId !== 'string') return;

        try {
            const style = await figma.getStyleByIdAsync(styleId);
            if (!style) {
                // スタイルが見つからない = remoteスタイルの可能性
                if (!remoteStylesMap.has(styleId)) {
                    remoteStylesMap.set(styleId, {
                        styleId,
                        styleName: 'Unknown Style (Remote)',
                        styleType,
                        layers: []
                    });
                }

                const info = remoteStylesMap.get(styleId)!;
                info.layers.push({
                    id: node.id,
                    name: node.name,
                    type: node.type
                });
            } else if (style.remote) {
                // remoteフラグが立っているスタイル
                if (!remoteStylesMap.has(styleId)) {
                    remoteStylesMap.set(styleId, {
                        styleId,
                        styleName: style.name,
                        styleType,
                        layers: []
                    });
                }

                const info = remoteStylesMap.get(styleId)!;
                info.layers.push({
                    id: node.id,
                    name: node.name,
                    type: node.type
                });
            }
        } catch (e) {
            // エラー = スタイルがローカルに存在しない
            if (!remoteStylesMap.has(styleId)) {
                remoteStylesMap.set(styleId, {
                    styleId,
                    styleName: 'Unknown Style (Remote)',
                    styleType,
                    layers: []
                });
            }

            const info = remoteStylesMap.get(styleId)!;
            info.layers.push({
                id: node.id,
                name: node.name,
                type: node.type
            });
        }
    }

    for (const child of figma.currentPage.children) {
        await traverse(child);
    }
    return Array.from(remoteStylesMap.values());
}

// ローカルスタイル一覧を取得
async function getLocalStyles(): Promise<LocalStyleInfo[]> {
    const styles: LocalStyleInfo[] = [];

    const paintStyles = await figma.getLocalPaintStylesAsync();
    const textStyles = await figma.getLocalTextStylesAsync();
    const effectStyles = await figma.getLocalEffectStylesAsync();
    const gridStyles = await figma.getLocalGridStylesAsync();

    paintStyles.forEach(s => {
        if (!s.remote) {
            styles.push({ id: s.id, name: s.name, type: 'FILL' });
        }
    });

    textStyles.forEach(s => {
        if (!s.remote) {
            styles.push({ id: s.id, name: s.name, type: 'TEXT' });
        }
    });

    effectStyles.forEach(s => {
        if (!s.remote) {
            styles.push({ id: s.id, name: s.name, type: 'EFFECT' });
        }
    });

    gridStyles.forEach(s => {
        if (!s.remote) {
            styles.push({ id: s.id, name: s.name, type: 'GRID' });
        }
    });

    return styles;
}

// レイヤーを選択
async function selectLayers(layerIds: string[]) {
    const nodes: SceneNode[] = [];
    for (const id of layerIds) {
        const node = await figma.getNodeByIdAsync(id) as SceneNode;
        if (node) nodes.push(node);
    }
    figma.currentPage.selection = nodes;
    if (nodes.length > 0) {
        figma.viewport.scrollAndZoomIntoView(nodes);
    }
}

// スタイルをスワップ
async function swapStyle(layerIds: string[], oldStyleId: string, newStyleId: string, styleType: string) {
    let count = 0;

    for (const id of layerIds) {
        const node = await figma.getNodeByIdAsync(id) as SceneNode;
        if (!node) continue;

        try {
            if (styleType === 'FILL') {
                if ('fillStyleId' in node && node.fillStyleId === oldStyleId) {
                    await node.setFillStyleIdAsync(newStyleId);
                    count++;
                }
                if ('strokeStyleId' in node && node.strokeStyleId === oldStyleId) {
                    await node.setStrokeStyleIdAsync(newStyleId);
                    count++;
                }
            } else if (styleType === 'TEXT') {
                if ('textStyleId' in node && node.textStyleId === oldStyleId) {
                    await node.setTextStyleIdAsync(newStyleId);
                    count++;
                }
            } else if (styleType === 'EFFECT') {
                if ('effectStyleId' in node && node.effectStyleId === oldStyleId) {
                    await node.setEffectStyleIdAsync(newStyleId);
                    count++;
                }
            } else if (styleType === 'GRID') {
                if ('gridStyleId' in node && node.gridStyleId === oldStyleId) {
                    await node.setGridStyleIdAsync(newStyleId);
                    count++;
                }
            }
        } catch (e) {
            console.error('Error swapping style:', e);
        }
    }

    return count;
}

// リモートスタイルをローカルに転送
async function importRemoteStyle(layerIds: string[], styleType: string, styleName: string, oldStyleId: string) {
    // 最初のレイヤーからスタイル情報を取得
    let newStyle: PaintStyle | TextStyle | EffectStyle | GridStyle | null = null;

    for (const id of layerIds) {
        const node = await figma.getNodeByIdAsync(id);
        if (!node) continue;

        try {
            if (styleType === 'FILL' && 'fills' in node) {
                const fills = node.fills;
                if (fills !== figma.mixed) {
                    newStyle = figma.createPaintStyle();
                    newStyle.name = styleName;
                    newStyle.paints = fills;
                    break;
                }
            } else if (styleType === 'TEXT' && node.type === 'TEXT') {
                const textNode = node as TextNode;
                // figma.mixedチェック
                if (textNode.fontSize !== figma.mixed &&
                    textNode.fontName !== figma.mixed &&
                    textNode.lineHeight !== figma.mixed &&
                    textNode.letterSpacing !== figma.mixed &&
                    textNode.textCase !== figma.mixed &&
                    textNode.textDecoration !== figma.mixed) {
                    newStyle = figma.createTextStyle();
                    newStyle.name = styleName;
                    newStyle.fontSize = textNode.fontSize;
                    newStyle.fontName = textNode.fontName;
                    newStyle.lineHeight = textNode.lineHeight;
                    newStyle.letterSpacing = textNode.letterSpacing;
                    newStyle.textCase = textNode.textCase;
                    newStyle.textDecoration = textNode.textDecoration;
                    break;
                }
            } else if (styleType === 'EFFECT' && 'effects' in node) {
                newStyle = figma.createEffectStyle();
                newStyle.name = styleName;
                newStyle.effects = node.effects;
                break;
            } else if (styleType === 'GRID' && 'layoutGrids' in node) {
                newStyle = figma.createGridStyle();
                newStyle.name = styleName;
                newStyle.layoutGrids = node.layoutGrids;
                break;
            }
        } catch (e) {
            console.error('Error importing style:', e);
        }
    }

    if (newStyle) {
        // 新しいスタイルを全レイヤーに適用
        return await swapStyle(layerIds, oldStyleId, newStyle.id, styleType);
    }

    return 0;
}

figma.ui.onmessage = async (msg) => {
    if (msg.type === 'scan') {
        const remoteStyles = await findLayersWithRemoteStyles();
        const localStyles = await getLocalStyles();

        figma.ui.postMessage({
            type: 'scan-result',
            remoteStyles,
            localStyles
        });
    } else if (msg.type === 'select-layers') {
        await selectLayers(msg.layerIds);
    } else if (msg.type === 'swap-style') {
        const count = await swapStyle(msg.layerIds, msg.oldStyleId, msg.newStyleId, msg.styleType);
        figma.notify(`${count}個のレイヤーのスタイルを変更しました`);

        // 再スキャン
        const remoteStyles = await findLayersWithRemoteStyles();
        const localStyles = await getLocalStyles();
        figma.ui.postMessage({
            type: 'scan-result',
            remoteStyles,
            localStyles
        });
    } else if (msg.type === 'import-style') {
        await figma.loadFontAsync({ family: "Inter", style: "Regular" });
        const count = await importRemoteStyle(msg.layerIds, msg.styleType, msg.styleName, msg.styleId);
        figma.notify(`スタイルをインポートし、${count}個のレイヤーに適用しました`);

        // 再スキャン
        const remoteStyles = await findLayersWithRemoteStyles();
        const localStyles = await getLocalStyles();
        figma.ui.postMessage({
            type: 'scan-result',
            remoteStyles,
            localStyles
        });
    } else if (msg.type === 'close') {
        figma.closePlugin();
    }
};

// 初回スキャン
(async () => {
    const remoteStyles = await findLayersWithRemoteStyles();
    const localStyles = await getLocalStyles();
    figma.ui.postMessage({
        type: 'scan-result',
        remoteStyles,
        localStyles
    });
})();

