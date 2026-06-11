// YouTube Playlist URL Copier — ポップアップ制御スクリプト

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

  // --- 動画リストの描画 ---
  function renderVideoList(videos) {
    videoList.innerHTML = '';
    videos.forEach((video, index) => {
      const item = document.createElement('div');
      item.className = 'video-item';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'video-checkbox';
      checkbox.id = `video-${index}`;
      checkbox.checked = true;
      checkbox.addEventListener('change', updateSelectionState);

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
      copyBtn.addEventListener('click', () => {
        const format = getSelectedCopyFormat();
        const copyText = format === 'titleAndUrl' ? `${video.title}\n${video.url}` : video.url;

        navigator.clipboard.writeText(copyText).then(() => {
          const originalText = copyBtn.textContent;
          copyBtn.textContent = '✓';
          copyBtn.classList.add('copied');
          setTimeout(() => {
            copyBtn.textContent = originalText;
            copyBtn.classList.remove('copied');
          }, 2000);
        }).catch(err => {
          console.error('コピー失敗', err);
          showMessage('コピーに失敗しました。', true);
        });
      });

      item.appendChild(checkbox);
      item.appendChild(numberLabel);
      item.appendChild(infoContainer);
      item.appendChild(copyBtn);
      videoList.appendChild(item);
    });

    selectAllCheckbox.checked = true;
    updateSelectionState();
  }

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
    const patterns = [
      /var\s+ytInitialData\s*=\s*(\{.+?\});\s*<\/script>/s,
      /window\["ytInitialData"\]\s*=\s*(\{.+?\});\s*<\/script>/s,
      /ytInitialData\s*=\s*(\{.+?\});\s*<\/script>/s
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        try {
          return JSON.parse(match[1]);
        } catch (e) {
          console.error('ytInitialData JSON解析失敗:', e.message);
        }
      }
    }

    const marker = 'var ytInitialData = ';
    const startIdx = html.indexOf(marker);
    if (startIdx !== -1) {
      const jsonStart = startIdx + marker.length;
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
              const jsonStr = html.substring(jsonStart, i + 1);
              try { return JSON.parse(jsonStr); } catch (e) { break; }
            }
          }
        }
      }
    }
    return null;
  }

  // --- APIキー抽出 ---
  function extractApiKey(html) {
    const patterns = [
      /"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/,
      /"innertubeApiKey"\s*:\s*"([^"]+)"/
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) return match[1];
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
    if (visitorDataMatch) info.visitorData = visitorDataMatch[1];

    return info;
  }

  // --- contents配列から動画とトークンを抽出 ---
  function extractVideosFromContents(contents) {
    const videos = [];
    let continuationToken = null;

    if (!Array.isArray(contents)) return { videos, continuationToken };

    contents.forEach(item => {
      const renderer = item?.playlistVideoRenderer;
      if (renderer) {
        const videoId = renderer.videoId;
        const title = renderer?.title?.runs?.[0]?.text
          || renderer?.title?.simpleText
          || '（タイトル不明）';
        if (videoId) {
          videos.push({
            title: title,
            url: `https://www.youtube.com/watch?v=${videoId}`
          });
        }
      }

      const contItem = item?.continuationItemRenderer;
      if (contItem) {
        let token = null;

        const commands = contItem?.continuationEndpoint?.commandExecutorCommand?.commands;
        if (Array.isArray(commands)) {
          for (const cmd of commands) {
            if (cmd?.continuationCommand?.token) {
              token = cmd.continuationCommand.token;
              break;
            }
          }
        }

        if (!token) token = contItem?.continuationEndpoint?.continuationCommand?.token;
        if (!token) token = contItem?.button?.buttonRenderer?.command?.continuationCommand?.token;

        if (token) continuationToken = token;
      }
    });

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
    if (!url.includes('youtube.com/playlist?list=')) {
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

      // 3. 初回データ抽出
      const playlistRenderer = initialData?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]
        ?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]
        ?.itemSectionRenderer?.contents?.[0]
        ?.playlistVideoListRenderer;

      if (!playlistRenderer) {
        console.warn('playlistVideoListRendererが見つからない、正規表現フォールバックを使用');
        handleFetchResult(extractVideosByRegex(html));
        getVideosBtn.disabled = false;
        return;
      }

      const allFetchedVideos = [];
      const contents = playlistRenderer?.contents || [];

      const { videos: firstVideos, continuationToken } = extractVideosFromContents(contents);
      allFetchedVideos.push(...firstVideos);

      if (allFetchedVideos.length === 0) {
        showMessage('動画が見つかりませんでした。URLが正しいか確認してください。', true);
        getVideosBtn.disabled = false;
        return;
      }

      showMessage(`🔄 ${allFetchedVideos.length} 件取得済み...`, false);

      // 4. APIキーを使用したcontinuation取得
      let nextToken = continuationToken;
      let pageCount = 0;
      const maxPages = 200; // 約20000動画まで

      while (nextToken && apiKey && pageCount < maxPages) {
        pageCount++;
        try {
          console.log(`continuation取得開始: ページ ${pageCount}`);

          const headers = {
            'Content-Type': 'application/json',
            'Accept-Language': 'ja,en;q=0.9',
            'X-YouTube-Client-Name': '1',
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
            console.error('continuation API応答エラー:', contResponse.status, await contResponse.text());
            break;
          }

          const contData = await contResponse.json();

          let contContents = contData?.onResponseReceivedActions?.[0]
            ?.appendContinuationItemsAction?.continuationItems;

          if (!contContents) {
            contContents = contData?.continuationContents
              ?.playlistVideoListContinuation?.contents;
          }

          if (!contContents || contContents.length === 0) break;

          const { videos: moreVideos, continuationToken: newToken } = extractVideosFromContents(contContents);
          if (moreVideos.length === 0) break;

          allFetchedVideos.push(...moreVideos);
          nextToken = newToken;

          showMessage(`🔄 ${allFetchedVideos.length} 件取得済み...続きを読み込んでいます...`, false);
        } catch (contError) {
          console.error('追加取得エラー:', contError);
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
