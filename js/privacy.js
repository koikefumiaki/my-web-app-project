// privacy.js
document.addEventListener('DOMContentLoaded', () => {
    // 戻るボタンのa要素を取得
    const backButton = document.getElementById('back-to-previous');

    // ブラウザの履歴から直前のURLを取得
    // 戻るURLが履歴に存在しない場合は、デフォルトで index.html に設定
    const referrer = document.referrer;
    
    // 開発環境で referrer が空になることがあるため、index.htmlをデフォルトにする
    let backUrl = 'index.html'; 

    if (referrer) {
        // 参照元URLを解析
        const url = new URL(referrer);
        const path = url.pathname;

        if (path.includes('result.html')) {
            // result.html から来た場合は、そのURL全体（パラメータ含む）に戻る
            backUrl = referrer;
        } else if (path.includes('index.html')) {
            // index.html から来た場合は、index.html に戻る
            backUrl = 'index.html';
        }
        // その他の場合は、デフォルトの index.html のまま
    }
    
    // 戻るボタンの href 属性を設定
    backButton.href = backUrl;

    // 画面がロードされた後、ブラウザの「戻る」機能を使うことで、
    // パラメータを維持したまま直前のページに戻るようにします
    backButton.addEventListener('click', (e) => {
        e.preventDefault(); // デフォルトのリンク遷移を停止
        window.history.back(); // ブラウザの履歴を戻る
    });
});