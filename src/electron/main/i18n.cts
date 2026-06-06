type LocaleCode = 'ja' | 'en'

type SettingsState = {
  general?: {
    locale?: string
  }
} | null | undefined

type MergePreviewSection = {
  label: string
  content: string
}

type MainI18n = {
  untitledTitle: string
  menu: {
    file: string
    newDocument: string
    open: string
    save: string
    saveAs: string
    settings: string
    view: string
    help: string
    about: string
    aiChat: string
    editor: string
    renderedPreview: string
  }
  buttons: {
    continue: string
    cancel: string
    save: string
    saveAs: string
    overwriteSave: string
    mergeSave: string
    close: string
    open: string
  }
  unsaved: {
    file: string
    hasUnsavedChanges: string
    title: string
    message: (proceedLabel: string) => string
  }
  closeFallback: {
    title: string
    message: string
    detail: string
  }
  externalLink: {
    title: string
    message: string
    allowAndRemember: string
    openOnce: string
    suggestedRuleLabel: string
  }
  fetchAclPrompt: {
    title: string
    message: string
    allow: string
    deny: string
    runOnce: string
    skipOnce: string
    applyToOrigin: string
    detailsLabel: string
    pendingMethod: (method: string, scope: string) => string
    pendingHeader: (headerName: string, scope: string) => string
    urlLabel: string
    methodLabel: string
    headersLabel: string
    none: string
  }
  fileDialog: {
    markdownFilter: string
    htmlFilter: string
    allFilesFilter: string
  }
  saveConflict: {
    title: string
    message: string
    detail: (targetPath: string) => string
    mergePreviewTitle: string
    mergePreviewMessage: string
    mergePreviewDetail: (targetPath: string, previewText: string) => string
    mergePreviewContinue: string
    mergeFailedTitle: string
    mergeFailedMessage: string
  }
  updater: {
    availableTitle: string
    availableMessage: (version: string) => string
    availableDetail: string
    invalidInstallMessage: (targetPath: string) => string
    downloadNow: string
    later: string
    downloadedTitle: string
    downloadedMessage: (version: string) => string
    downloadedDetail: string
    restartNow: string
    checkFailedTitle: string
    notAvailableTitle: string
    notAvailableMessage: string
  }
}

function buildMergePreviewText(baseContent: unknown, editorContent: unknown, mergedContent: unknown, currentDiskContent: unknown) {
  const sections: MergePreviewSection[] = [
    { label: 'Merged result', content: typeof mergedContent === 'string' ? mergedContent : '' },
    { label: 'Current file on disk', content: typeof currentDiskContent === 'string' ? currentDiskContent : '' },
    { label: 'Your editor content', content: typeof editorContent === 'string' ? editorContent : '' },
    { label: 'Last synchronized content', content: typeof baseContent === 'string' ? baseContent : '' },
  ]

  return sections
    .map(({ label, content }) => `=== ${label} ===\n${content.length > 0 ? content : '(empty)'}`)
    .join('\n\n')
}

const MAIN_I18N: Record<LocaleCode, MainI18n> = {
  ja: {
    untitledTitle: '無題.md',
    menu: {
      file: 'ファイル',
      newDocument: '新規文書',
      open: '開く',
      save: '保存',
      saveAs: '名前を付けて保存',
      settings: '設定',
      view: '表示',
      help: 'ヘルプ',
      about: 'MDV について',
      aiChat: 'AI Chat',
      editor: 'エディタ',
      renderedPreview: 'レンダリングプレビュー',
    },
    buttons: {
      continue: '続行',
      cancel: 'キャンセル',
      save: '保存',
      saveAs: '名前を付けて保存',
      overwriteSave: '上書き保存',
      mergeSave: 'マージ保存',
      close: '閉じる',
      open: '開く',
    },
    unsaved: {
      file: 'ファイル',
      hasUnsavedChanges: '未保存の変更があります。',
      title: '保存されていない変更があります',
      message: (proceedLabel) => `このまま${proceedLabel}しますか？`,
    },
    closeFallback: {
      title: 'ウィンドウを閉じる前に確認できませんでした',
      message: 'エディタの状態を取得できませんでした。',
      detail: '保存されていない変更がある場合は失われる可能性があります。閉じる場合はそのまま終了します。',
    },
    externalLink: {
      title: '未許可の外部サイトです',
      message: '未許可の外部サイトを開こうとしています。',
      allowAndRemember: '許可リストに登録して表示',
      openOnce: '今回のみ表示',
      suggestedRuleLabel: '登録候補',
    },
    fetchAclPrompt: {
      title: 'fetch_url は保留中です',
      message: 'この fetch リクエストは ACL 上で保留です。',
      allow: '許可して保存',
      deny: '拒否して保存',
      runOnce: '今回のみ実行',
      skipOnce: '今回は実行しない',
      applyToOrigin: '現在のパスではなくオリジン単位に適用する',
      detailsLabel: '判定詳細',
      pendingMethod: (method, scope) => `メソッド ${method} が ${scope} で保留です。`,
      pendingHeader: (headerName, scope) => `ヘッダー ${headerName} が ${scope} で保留です。`,
      urlLabel: 'URL',
      methodLabel: 'Method',
      headersLabel: 'Headers',
      none: '(なし)',
    },
    fileDialog: {
      markdownFilter: 'Markdown',
      htmlFilter: 'HTML',
      allFilesFilter: 'すべてのファイル',
    },
    saveConflict: {
      title: 'ローカルファイルが更新されています',
      message: '前回同期時からローカルファイルが変更されています。',
      detail: (targetPath) => [
        `保存先: ${targetPath}`,
        '上書き保存: ローカルファイルをそのまま置き換えます。',
        '名前を付けて保存: 現在の編集中内容を別ファイルへ保存します。',
        'マージ保存: 前回同期内容を基準に、ローカル変更と編集中変更の両方を自動マージします。',
      ].join('\n'),
      mergePreviewTitle: 'マージ結果を確認',
      mergePreviewMessage: '自動マージで保存する内容を確認してください。',
      mergePreviewDetail: (targetPath, previewText) => `保存先: ${targetPath}\n\n${previewText}`,
      mergePreviewContinue: 'この内容でマージ保存',
      mergeFailedTitle: 'マージ保存に失敗しました',
      mergeFailedMessage: '競合を自動マージできなかったため、保存せず編集へ戻ります。',
    },
    updater: {
      availableTitle: 'アップデートがあります',
      availableMessage: (version) => `Version ${version} を利用できます。ダウンロードしますか？`,
      availableDetail: 'installer build のみ自動更新を利用できます。portable build は手動更新のままです。',
      invalidInstallMessage: (targetPath) => `この installer インストールは壊れています。更新設定ファイル ${targetPath} が見つかりません。installer から再インストールしてください。`,
      downloadNow: 'ダウンロード',
      later: 'あとで',
      downloadedTitle: 'アップデートをダウンロードしました',
      downloadedMessage: (version) => `Version ${version} をインストールできます。今すぐ再起動しますか？`,
      downloadedDetail: '再起動すると新しい version を適用します。',
      restartNow: '再起動して更新',
      checkFailedTitle: 'アップデート確認に失敗しました',
      notAvailableTitle: 'アップデートはありません',
      notAvailableMessage: '現在の version は最新です。',
    },
  },
  en: {
    untitledTitle: 'Untitled.md',
    menu: {
      file: 'File',
      newDocument: 'New Document',
      open: 'Open',
      save: 'Save',
      saveAs: 'Save As',
      settings: 'Settings',
      view: 'View',
      help: 'Help',
      about: 'About MDV',
      aiChat: 'AI Chat',
      editor: 'Editor',
      renderedPreview: 'Rendered Preview',
    },
    buttons: {
      continue: 'Continue',
      cancel: 'Cancel',
      save: 'Save',
      saveAs: 'Save As',
      overwriteSave: 'Overwrite Save',
      mergeSave: 'Merge Save',
      close: 'Close',
      open: 'Open',
    },
    unsaved: {
      file: 'File',
      hasUnsavedChanges: 'You have unsaved changes.',
      title: 'Unsaved changes',
      message: (proceedLabel) => `Do you want to ${proceedLabel.toLowerCase()} without saving?`,
    },
    closeFallback: {
      title: 'Unable to confirm before closing',
      message: 'The editor state could not be retrieved.',
      detail: 'If there are unsaved changes, they may be lost. Closing will exit immediately.',
    },
    externalLink: {
      title: 'Untrusted external site',
      message: 'You are about to open an untrusted external site.',
      allowAndRemember: 'Allow and remember',
      openOnce: 'Open once',
      suggestedRuleLabel: 'Suggested allow rule',
    },
    fetchAclPrompt: {
      title: 'fetch_url is pending',
      message: 'This fetch request is pending under the current ACL.',
      allow: 'Allow and save',
      deny: 'Deny and save',
      runOnce: 'Run once',
      skipOnce: 'Do not run',
      applyToOrigin: 'Apply to the whole origin instead of only this path',
      detailsLabel: 'Decision details',
      pendingMethod: (method, scope) => `Method ${method} is pending at ${scope}.`,
      pendingHeader: (headerName, scope) => `Header ${headerName} is pending at ${scope}.`,
      urlLabel: 'URL',
      methodLabel: 'Method',
      headersLabel: 'Headers',
      none: '(none)',
    },
    fileDialog: {
      markdownFilter: 'Markdown',
      htmlFilter: 'HTML',
      allFilesFilter: 'All Files',
    },
    saveConflict: {
      title: 'The local file changed',
      message: 'The local file changed since the last synchronized version.',
      detail: (targetPath) => [
        `Save target: ${targetPath}`,
        'Overwrite Save: replace the local file with your current editor content.',
        'Save As: keep the local file as-is and write your current editor content to another file.',
        'Merge Save: auto-merge the local file changes and your editor changes against the last synchronized content.',
      ].join('\n'),
      mergePreviewTitle: 'Review merged result',
      mergePreviewMessage: 'Confirm the content that will be written by merge save.',
      mergePreviewDetail: (targetPath, previewText) => `Save target: ${targetPath}\n\n${previewText}`,
      mergePreviewContinue: 'Merge Save This Result',
      mergeFailedTitle: 'Merge save failed',
      mergeFailedMessage: 'The app could not merge the changes automatically. The document was not saved and editing will continue.',
    },
    updater: {
      availableTitle: 'Update available',
      availableMessage: (version) => `Version ${version} is available. Download it now?`,
      availableDetail: 'Auto-update is supported only for installer builds. Portable builds stay on manual updates.',
      invalidInstallMessage: (targetPath) => `This installer-based installation is broken. The updater config file ${targetPath} is missing. Reinstall the app from the installer.`,
      downloadNow: 'Download',
      later: 'Later',
      downloadedTitle: 'Update downloaded',
      downloadedMessage: (version) => `Version ${version} is ready to install. Restart now?`,
      downloadedDetail: 'Restarting will apply the downloaded update.',
      restartNow: 'Restart and install',
      checkFailedTitle: 'Update check failed',
      notAvailableTitle: 'No update available',
      notAvailableMessage: 'You already have the latest version.',
    },
  },
}

function getMainLocale(settingsState: SettingsState): LocaleCode {
  return settingsState?.general?.locale === 'ja' ? 'ja' : 'en'
}

function getMainI18n(settingsState: SettingsState): MainI18n {
  return MAIN_I18N[getMainLocale(settingsState)]
}

export {
  MAIN_I18N,
  buildMergePreviewText,
  getMainI18n,
  getMainLocale,
}
