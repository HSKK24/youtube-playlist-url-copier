// YouTube Playlist URL Copier — ポップアップ制御スクリプト

const MAX_PAGES = 200;          // continuation ループ上限（約20,000動画）
const CONTINUATION_DELAY_MS = 150; // ページ間の待機時間（レート制御）
const YT_CLIENT_NAME_WEB = '1'; // YouTube 内部クライアント識別子（WEB = "1"）

const ALLOWED_YT_HOSTS = new Set(['www.youtube.com', 'youtube.com', 'm.youtube.com']);

/** プレイリストURLとして有効かどうか検証する */
function isValidPlaylistUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return ALLOWED_YT_HOSTS.has(parsed.hostname)
      && parsed.pathname === '/playlist'
      && parsed.searchParams.has('list');
  } catch {
    return false;
  }
}

/** 指定ミリ秒待機する */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * オブジェクトを再帰的に探索して playlistVideoListRenderer を返す。
 * YouTube の内部構造変更に対応するためパスを固定しない。
 */
function findPlaylistVideoListRenderer(obj, depth = 0) {
  if (depth > 15 || !obj || typeof obj !== 'object') return null;
  if (obj.playlistVideoListRenderer) return obj.playlistVideoListRenderer;
  for (const value of Object.values(obj)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const result = findPlaylistVideoListRenderer(item, depth + 1);
        if (result) return result;
      }
    } else if (value && typeof value === 'object') {
      const result = findPlaylistVideoListRenderer(value, depth + 1);
      if (result) return result;
    }
  }
  return null;
}

/**
 * playlistVideoListRenderer が見つからない場合のフォールバック。
 * ytInitialData 全体から playlistVideoRenderer を直接収集する。
 * continuation token も同時に探す。
 */
function extractVideosDirectly(obj, result = { videos: [], continuationToken: null }, depth = 0) {
  if (depth > 20 || !obj || typeof obj !== 'object') return result;

  if (obj.playlistVideoRenderer) {
    const r = obj.playlistVideoRenderer;
    const videoId = r.videoId;
    const title = r?.title?.runs?.[0]?.text || r?.title?.simpleText || '（タイトル不明）';
    if (videoId) result.videos.push({ title, url: `https://www.youtube.com/watch?v=${videoId}` });
  }

  if (!result.continuationToken) {
    // continuationItemRenderer パターン（通常ルートと同じロジック）
    if (obj.continuationItemRenderer) {
      const ci = obj.continuationItemRenderer;
      const commands = ci?.continuationEndpoint?.commandExecutorCommand?.commands;
      if (Array.isArray(commands)) {
        for (const cmd of commands) {
          if (cmd?.continuationCommand?.token) {
            result.continuationToken = cmd.continuationCommand.token;
            break;
          }
        }
      }
      if (!result.continuationToken) {
        result.continuationToken = ci?.continuationEndpoint?.continuationCommand?.token
          || ci?.button?.buttonRenderer?.command?.continuationCommand?.token
          || null;
      }
    }
    // シンプルな continuationCommand.token パターン
    if (!result.continuationToken && obj.continuationCommand?.token) {
      result.continuationToken = obj.continuationCommand.token;
    }
  }

  for (const value of Object.values(obj)) {
    if (Array.isArray(value)) {
      for (const item of value) extractVideosDirectly(item, result, depth + 1);
    } else if (value && typeof value === 'object') {
      extractVideosDirectly(value, result, depth + 1);
    }
  }
  return result;
}

document.addEventListener('DOMContentLoaded', () => {
  const getVideosBtn = document.getElementById('getVideosBtn');
  const messageArea = document.getElementById('messageArea');
  const videoList = document.getElementById('videoList');
  const videoCount = document.getElementById('videoCount');
  const copySelectedBtn = document.getElementById('copySelectedBtn');
  const selectAllCheckbox = document.getElementById('selectAllCheckbox');
  const rangeStart = document.getElementById('rangeStart');
  const rangeEnd = document.getElementById('rangeEnd');
  const selectRangeBtn = document.getElementById('selectRangeBtn');
  const closeBtn = document.getElementById('closeBtn');
  const playlistUrlInput = document.getElementById('playlistUrl');

  let allVideos = [];

  // --- メッセージ表示 ---
  function showMessage(text, isError = false) {
    messageArea.textContent = text;
    messageArea.className = 'message ' + (isError ? 'error' : 'success');
  }

  function clearMessage() {
    messageArea.textContent = '';
    messageArea.className = 'message';
  }

  // --- コピー形式の取得 ---
  function getSelectedCopyFormat() {
    const checkedRadio = document.querySelector('input[name="copyFormat"]:checked');
    return checkedRadio ? checkedRadio.value : 'urlOnly';
  }

  // --- 動画リストの描画（DocumentFragment で一括挿入しリフローを最小化）---
  function renderVideoList(videos) {
    const fragment = document.createDocumentFragment();
    videos.forEach((video, index) => {
      const item = document.createElement('div');
      item.className = 'video-item';
      item.dataset.index = index;

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'video-checkbox';
      checkbox.checked = true;

      const numberLabel = document.createElement('span');
      numberLabel.className = 'video-number';
      numberLabel.textContent = `${index + 1}.`;

      const infoContainer = document.createElement('div');
      infoContainer.className = 'video-info';

      const titleSpan = document.createElement('span');
      titleSpan.className = 'video-title';
      titleSpan.textContent = video.title;
      titleSpan.title = video.title;

      const urlSpan = document.createElement('span');
      urlSpan.className = 'video-url';
      urlSpan.textContent = video.url;
      urlSpan.title = video.url;

      infoContainer.appendChild(titleSpan);
      infoContainer.appendChild(urlSpan);

      const copyBtn = document.createElement('button');
      copyBtn.className = 'copy-btn';
      copyBtn.textContent = 'コピー';
      copyBtn.dataset.index = index;

      item.appendChild(checkbox);
      item.appendChild(numberLabel);
      item.appendChild(infoContainer);
      item.appendChild(copyBtn);
      fragment.appendChild(item);
    });

    videoList.replaceChildren(fragment);
    selectAllCheckbox.checked = true;
    updateSelectionState();
  }

  // --- イベント委譲: コピーボタン（個別コピー）---
  videoList.addEventListener('click', (e) => {
    const copyBtn = e.target.closest('.copy-btn');
    if (!copyBtn) return;
    const index = parseInt(copyBtn.dataset.index, 10);
    const video = allVideos[index];
    if (!video) return;

    const format = getSelectedCopyFormat();
    const copyText = format === 'titleAndUrl' ? `${video.title}\n${video.url}` : video.url;

    navigator.clipboard.writeText(copyText).then(() => {
      const original = copyBtn.textContent;
      copyBtn.textContent = '✓';
      copyBtn.classList.add('copied');
      setTimeout(() => {
        copyBtn.textContent = original;
        copyBtn.classList.remove('copied');
      }, 2000);
    }).catch(err => {
      console.error('コピー失敗', err);
      showMessage('コピーに失敗しました。', true);
    });
  });

  // --- イベント委譲: チェックボックス変更 ---
  videoList.addEventListener('change', (e) => {
    if (e.target.classList.contains('video-checkbox')) updateSelectionState();
  });

  // --- 選択状態の更新 ---
  function updateSelectionState() {
    const checkboxes = videoList.querySelectorAll('.video-checkbox');
    const checkedCount = videoList.querySelectorAll('.video-checkbox:checked').length;
    const totalCount = checkboxes.length;

    selectAllCheckbox.checked = checkedCount === totalCount;
    selectAllCheckbox.indeterminate = checkedCount > 0 && checkedCount < totalCount;
    copySelectedBtn.disabled = checkedCount === 0;
    videoCount.textContent = `${checkedCount}/${totalCount} 件選択中`;
  }

  // --- 全選択/全解除 ---
  selectAllCheckbox.addEventListener('change', () => {
    const checkboxes = videoList.querySelectorAll('.video-checkbox');
    checkboxes.forEach(cb => {
      cb.checked = selectAllCheckbox.checked;
    });
    updateSelectionState();
  });

  // --- 範囲選択 ---
  selectRangeBtn.addEventListener('click', () => {
    const start = parseInt(rangeStart.value, 10);
    const end = parseInt(rangeEnd.value, 10);

    if (isNaN(start) || isNaN(end)) {
      showMessage('開始番号と終了番号を入力してください。', true);
      return;
    }
    if (start < 1 || end < start) {
      showMessage('正しい範囲を入力してください（開始 ≤ 終了）。', true);
      return;
    }

    const checkboxes = videoList.querySelectorAll('.video-checkbox');
    if (checkboxes.length === 0) {
      showMessage('先に動画を取得してください。', true);
      return;
    }

    checkboxes.forEach((cb, i) => {
      const num = i + 1;
      cb.checked = num >= start && num <= Math.min(end, checkboxes.length);
    });

    updateSelectionState();
    clearMessage();
  });

  // --- UIリセット ---
  function resetUI() {
    clearMessage();
    videoList.innerHTML = '';
    videoCount.textContent = '';
    copySelectedBtn.disabled = true;
    allVideos = [];
  }

  // --- ytInitialDataの安全な抽出 ---
  function extractYtInitialData(html) {
    // YouTubeのHTML変更に対応するため複数マーカーを試す
    const markers = [
      'var ytInitialData = ',
      'window["ytInitialData"] = ',
      "window['ytInitialData'] = ",
      'window.ytInitialData = ',
      'ytInitialData = ',
    ];

    for (const marker of markers) {
      const startIdx = html.indexOf(marker);
      if (startIdx === -1) continue;

      const jsonStart = startIdx + marker.length;
      if (html[jsonStart] !== '{') continue;

      // ブレースカウンタ方式で正確にJSONの終端を見つける
      let depth = 0;
      let inString = false;
      let escape = false;

      for (let i = jsonStart; i < html.length; i++) {
        const ch = html[i];
        if (escape) { escape = false; continue; }
        if (ch === '\\' && inString) { escape = true; continue; }
        if (ch === '"') { inString = !inString; continue; }

        if (!inString) {
          if (ch === '{') depth++;
          else if (ch === '}') {
            depth--;
            if (depth === 0) {
              try {
                return JSON.parse(html.substring(jsonStart, i + 1));
              } catch (e) {
                console.warn('ytInitialData JSON解析失敗 (marker:', marker.trim(), '):', e.message);
                break;
              }
            }
          }
        }
      }
    }
    return null;
  }

  // --- APIキー抽出 ---
  const SAFE_API_KEY_RE = /^[A-Za-z0-9_-]+$/;
  const SAFE_VISITOR_DATA_RE = /^[A-Za-z0-9%+/=_-]+$/;

  function extractApiKey(html) {
    const patterns = [
      /"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/,
      /"innertubeApiKey"\s*:\s*"([^"]+)"/
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match && SAFE_API_KEY_RE.test(match[1])) return match[1];
    }
    return null;
  }

  // --- クライアント情報の抽出（Bot回避用） ---
  function extractClientInfo(html) {
    const info = {
      clientName: 'WEB',
      clientVersion: '2.20260306.01.00',
      visitorData: ''
    };

    const clientNameMatch = html.match(/"clientName"\s*:\s*"([^"]+)"/);
    if (clientNameMatch) info.clientName = clientNameMatch[1];

    const clientVersionMatch = html.match(/"clientVersion"\s*:\s*"([^"]+)"/);
    if (clientVersionMatch) info.clientVersion = clientVersionMatch[1];

    const visitorDataMatch = html.match(/"visitorData"\s*:\s*"([^"]+)"/);
    if (visitorDataMatch && SAFE_VISITOR_DATA_RE.test(visitorDataMatch[1])) {
      info.visitorData = visitorDataMatch[1];
    }

    return info;
  }

  // --- contents配列から動画とトークンを抽出（旧形式・新形式両対応）---
  function extractVideosFromContents(contents) {
    const videos = [];
    let continuationToken = null;

    if (!Array.isArray(contents)) return { videos, continuationToken };

    contents.forEach(item => {
      // 旧形式: playlistVideoRenderer
      const renderer = item?.playlistVideoRenderer;
      if (renderer?.videoId) {
        videos.push({
          title: renderer?.title?.runs?.[0]?.text || renderer?.title?.simpleText || '（タイトル不明）',
          url: `https://www.youtube.com/watch?v=${renderer.videoId}`
        });
      }

      // 新形式: lockupViewModel (YouTube 2025+)
      const lvm = item?.lockupViewModel;
      if (lvm?.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO' && lvm?.contentId) {
        videos.push({
          title: lvm?.metadata?.lockupMetadataViewModel?.title?.content || '（タイトル不明）',
          url: `https://www.youtube.com/watch?v=${lvm.contentId}`
        });
      }

      // 旧形式 continuation: continuationItemRenderer
      const contItem = item?.continuationItemRenderer;
      if (contItem) {
        let token = null;
        const commands = contItem?.continuationEndpoint?.commandExecutorCommand?.commands;
        if (Array.isArray(commands)) {
          for (const cmd of commands) {
            if (cmd?.continuationCommand?.token) { token = cmd.continuationCommand.token; break; }
          }
        }
        if (!token) token = contItem?.continuationEndpoint?.continuationCommand?.token;
        if (!token) token = contItem?.button?.buttonRenderer?.command?.continuationCommand?.token;
        if (token) continuationToken = token;
      }

      // 新形式 continuation: continuationItemViewModel (YouTube 2025+)
      const contVM = item?.continuationItemViewModel;
      if (contVM?.continuationCommand?.token) {
        continuationToken = contVM.continuationCommand.token;
      }
    });

    return { videos, continuationToken };
  }

  // --- 新形式: sectionList から動画と continuation token を抽出 ---
  function extractFromSectionList(sections) {
    const videos = [];
    let continuationToken = null;

    if (!Array.isArray(sections)) return { videos, continuationToken };

    for (const section of sections) {
      // 動画アイテム: itemSectionRenderer.contents に lockupViewModel が並ぶ
      if (section.itemSectionRenderer) {
        const { videos: v, continuationToken: t } = extractVideosFromContents(
          section.itemSectionRenderer.contents || []
        );
        videos.push(...v);
        if (t) continuationToken = t;
      }
      // 新形式 continuation: セクション自体が continuationItemViewModel
      const contVM = section?.continuationItemViewModel;
      if (contVM?.continuationCommand?.token) {
        continuationToken = contVM.continuationCommand.token;
      }
    }

    return { videos, continuationToken };
  }

  // --- 正規表現フォールバック ---
  function extractVideosByRegex(html) {
    const videos = [];
    const regex = /watch\?v=([a-zA-Z0-9_-]{11})/g;
    const ids = new Set();
    let match;
    while ((match = regex.exec(html)) !== null) {
      ids.add(match[1]);
    }
    Array.from(ids).forEach(id => {
      videos.push({
        title: '（タイトル取得不可）',
        url: `https://www.youtube.com/watch?v=${id}`
      });
    });
    return videos;
  }

  function handleFetchResult(videos) {
    if (!videos || videos.length === 0) {
      showMessage('動画が見つかりませんでした。URLが正しいか確認してください。', true);
      return;
    }
    allVideos = videos;
    renderVideoList(videos);
    showMessage(`✅ ${videos.length} 件の動画を取得しました。`, false);
  }

  // --- メイン取得処理 ---
  getVideosBtn.addEventListener('click', async () => {
    const url = playlistUrlInput.value.trim();

    if (!url) {
      showMessage('プレイリストURLを入力してください。', true);
      return;
    }
    if (!isValidPlaylistUrl(url)) {
      showMessage('有効なYouTubeプレイリストURLを入力してください。', true);
      return;
    }

    resetUI();
    showMessage('🔄 動画を取得中...', false);
    getVideosBtn.disabled = true;

    try {
      // 1. 初回のHTMLを取得
      const response = await fetch(url, {
        headers: {
          'Accept-Language': 'ja,en;q=0.9'
        },
        credentials: 'include'
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const html = await response.text();

      // 2. ytInitialDataとAPIキーとクライアント情報を抽出
      const initialData = extractYtInitialData(html);
      const apiKey = extractApiKey(html);
      const clientInfo = extractClientInfo(html);

      if (!initialData) {
        console.warn('ytInitialData抽出失敗、正規表現フォールバックを使用');
        handleFetchResult(extractVideosByRegex(html));
        getVideosBtn.disabled = false;
        return;
      }

      // 3. 初回動画データ抽出（旧形式・新形式両対応）
      const allFetchedVideos = [];
      let continuationToken;

      // 優先1: 旧形式 playlistVideoListRenderer（再帰検索）
      const playlistRenderer = findPlaylistVideoListRenderer(initialData);
      if (playlistRenderer) {
        const { videos, continuationToken: t } = extractVideosFromContents(playlistRenderer.contents || []);
        allFetchedVideos.push(...videos);
        continuationToken = t;
      }

      // 優先2: 新形式 lockupViewModel（sectionListRenderer 配下）
      if (allFetchedVideos.length === 0) {
        const sections = initialData?.contents?.twoColumnBrowseResultsRenderer
          ?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents;
        const { videos, continuationToken: t } = extractFromSectionList(sections);
        allFetchedVideos.push(...videos);
        continuationToken = t;
      }

      // 優先3: 全ツリー再帰（extractVideosDirectly）
      if (allFetchedVideos.length === 0) {
        const { videos, continuationToken: t } = extractVideosDirectly(initialData);
        allFetchedVideos.push(...videos);
        continuationToken = t;
      }

      // 最終: 正規表現フォールバック（タイトルなし）
      if (allFetchedVideos.length === 0) {
        handleFetchResult(extractVideosByRegex(html));
        getVideosBtn.disabled = false;
        return;
      }

      showMessage(`🔄 ${allFetchedVideos.length} 件取得済み...`, false);

      // 4. APIキーを使用したcontinuation取得
      let nextToken = continuationToken;
      let pageCount = 0;

      while (nextToken && apiKey && pageCount < MAX_PAGES) {
        pageCount++;
        await sleep(CONTINUATION_DELAY_MS);
        try {
          const headers = {
            'Content-Type': 'application/json',
            'Accept-Language': 'ja,en;q=0.9',
            'X-YouTube-Client-Name': YT_CLIENT_NAME_WEB,
            'X-YouTube-Client-Version': clientInfo.clientVersion,
            'Origin': 'https://www.youtube.com'
          };

          if (clientInfo.visitorData) {
            headers['X-Goog-Visitor-Id'] = clientInfo.visitorData;
          }

          const contResponse = await fetch(
            `https://www.youtube.com/youtubei/v1/browse?key=${apiKey}&prettyPrint=false`,
            {
              method: 'POST',
              headers: headers,
              credentials: 'include',
              body: JSON.stringify({
                context: {
                  client: {
                    hl: 'ja',
                    gl: 'JP',
                    clientName: clientInfo.clientName,
                    clientVersion: clientInfo.clientVersion,
                    visitorData: clientInfo.visitorData
                  }
                },
                continuation: nextToken
              })
            }
          );

          if (!contResponse.ok) {
            console.warn('continuation API応答エラー:', contResponse.status);
            break;
          }

          const contData = await contResponse.json();

          // 新形式・旧形式どちらの continuation レスポンスにも対応
          const contItems = contData?.onResponseReceivedActions?.[0]
            ?.appendContinuationItemsAction?.continuationItems
            || contData?.continuationContents?.playlistVideoListContinuation?.contents;

          if (!contItems || contItems.length === 0) break;

          // flat な items 配列として処理（旧形式・新形式両対応）
          const { videos: moreVideos, continuationToken: newToken } = extractVideosFromContents(contItems);

          // extractFromSectionList も試す（新形式で sections 構造の場合）
          if (moreVideos.length === 0) break;

          allFetchedVideos.push(...moreVideos);
          nextToken = newToken ?? null;

          showMessage(`🔄 ${allFetchedVideos.length} 件取得済み...続きを読み込んでいます...`, false);
        } catch (contError) {
          console.warn('continuation取得エラー:', contError);
          break;
        }
      }

      handleFetchResult(allFetchedVideos);

    } catch (error) {
      console.error('取得エラー:', error);
      showMessage('プレイリストの取得に失敗しました。URLが正しいか確認してください。', true);
    } finally {
      getVideosBtn.disabled = false;
    }
  });

  // --- 選択した動画をコピー ---
  copySelectedBtn.addEventListener('click', () => {
    const checkboxes = videoList.querySelectorAll('.video-checkbox');
    const selectedVideos = [];

    checkboxes.forEach((cb, i) => {
      if (cb.checked && allVideos[i]) {
        selectedVideos.push(allVideos[i]);
      }
    });

    if (selectedVideos.length === 0) {
      showMessage('コピーする動画を選択してください。', true);
      return;
    }

    const format = getSelectedCopyFormat();
    const textToCopy = selectedVideos
      .map(v => format === 'titleAndUrl' ? `${v.title}\n${v.url}` : v.url)
      .join(format === 'titleAndUrl' ? '\n\n' : '\n');

    navigator.clipboard.writeText(textToCopy).then(() => {
      const originalText = copySelectedBtn.textContent;
      copySelectedBtn.textContent = `✅ ${selectedVideos.length} 件コピーしました！`;
      setTimeout(() => {
        copySelectedBtn.textContent = originalText;
      }, 2000);
    }).catch(err => {
      console.error('一括コピー失敗', err);
      showMessage('コピーに失敗しました。', true);
    });
  });

  // --- 閉じるボタン ---
  closeBtn.addEventListener('click', () => {
    window.close();
  });
});
