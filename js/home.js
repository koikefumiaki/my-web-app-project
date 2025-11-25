// =====================================================================
// 愛知マイ備蓄ナビ - HOME画面ロジック (home.js)
// 役割: データのロード、市町村選択肢の生成、検索クエリの構築と画面遷移
// =====================================================================

// ----------------------------------------------------
// 1. 定数とグローバル変数の定義 (result.jsと共通)
// ----------------------------------------------------

const API_KEY = "AIzaSyAV0j-JNMRDpyvwk-6OxhpPzKLhG5fT9IE"; // ★★★ Google Maps APIキーに置き換えてください ★★★
const DATA_PATHS = {
    CITIES: '/my-web-app-project/data/aichi_cities.json', 
    HAZARD: '/my-web-app-project/data/hazard_data.json',   
    SUPPLY: '/my-web-app-project/data/supply_data.json',   
    SHELTER: '/my-web-app-project/data/shelter_list.json'  
};
let appData = {};

// ★★★ 追加: LocalStorageキーの定義 ★★★
const STORAGE_KEY = 'aichiMyBichikuProfile';

// ----------------------------------------------------
// 2. データの読み込み処理 (result.jsと共通)
// ----------------------------------------------------

/**
 * すべてのデータを非同期でロードし、appDataオブジェクトに格納する。
 * @returns {Promise<boolean>} データロードが成功したかどうか
 */
async function loadAllData() {
    console.log("データの読み込みを開始...");
    
    const loadPromises = [
        fetch(DATA_PATHS.CITIES).then(res => res.json()).catch(() => []), 
        fetch(DATA_PATHS.HAZARD).then(res => res.json()).catch(() => []),
        fetch(DATA_PATHS.SUPPLY).then(res => res.json()).catch(() => ({unit_standards: [], general_necessities: []})),
        fetch(DATA_PATHS.SHELTER)
            .then(res => res.json())
            .catch((error) => {
                console.error("Shelter data not found or failed to parse. Using empty list.", error);
                return []; 
            })
    ];

    try {
        const [cities, hazard, supply, shelterRaw] = await Promise.all(loadPromises);
        
        appData.cities = cities;
        appData.hazard = hazard;
        appData.supply = supply;
        
        // 避難所データは座標を数値に変換し、無効なデータを除外
        appData.shelter = shelterRaw
            .map(s => {
                const latNum = parseFloat(s.latitude);
                const lngNum = parseFloat(s.longitude);
                return (isNaN(latNum) || isNaN(lngNum)) ? null : {
                    name: s.name, lat: latNum, lng: lngNum, address: s.address || '住所情報なし'
                };
            })
            .filter(s => s !== null);
        
        console.log("データ読み込み完了:", appData);
        return true;
    } catch (error) {
        console.error("データの読み込み中に致命的なエラーが発生しました:", error);
        return false;
    }
}

// ----------------------------------------------------
// 3. HOME画面のロジック 
// ----------------------------------------------------

/**
 * HOME画面の初期化処理
 */
function initHome() {
    const searchButton = document.getElementById('search-button');
    searchButton.addEventListener('click', handleHomeSearch);
    
    loadAllData().then(dataLoaded => {
        if (dataLoaded) {
            populateCitySelect();
            // ★★★ 追加: 保存されたプロフィールをロードしてフォームに適用 ★★★
            loadSavedProfile(); 
        } else {
            // データロード失敗時は検索ボタンを無効化
            searchButton.disabled = true;
        }
    });
}

/**
 * 市町村選択のプルダウンをデータに基づいて生成する
 */
function populateCitySelect() {
    const citySelect = document.getElementById('city-select');
    if (Array.isArray(appData.cities) && appData.cities.length > 0) {
        let optionsHtml = ''; 
        appData.cities.forEach(cityObj => {
            const cityName = cityObj.city_name_jp;
            optionsHtml += `<option value="${cityName}">${cityName}</option>`;
        });
        citySelect.insertAdjacentHTML('beforeend', optionsHtml);
    } else {
        citySelect.insertAdjacentHTML('beforeend', '<option value="" disabled>データ読み込みエラー</option>');
    }
}

// ★★★ 追加: LocalStorageから保存されたデータをロードし、フォームに反映する関数 ★★★
function loadSavedProfile() {
    const savedData = localStorage.getItem(STORAGE_KEY);
    if (savedData) {
        try {
            const profile = JSON.parse(savedData);
            
            // フォーム要素に値を設定
            document.getElementById('city-select').value = profile.city || '';
            document.getElementById('address-input').value = profile.addr || '';
            document.getElementById('family-size').value = profile.size || 1;
            document.getElementById('duration-days').value = profile.days || 7;

            console.log("Saved profile loaded and applied.");
        } catch (e) {
            console.error("Error parsing saved profile. Clearing corrupted data.", e);
            localStorage.removeItem(STORAGE_KEY); 
        }
    }
}


/**
 * 検索ボタンクリック時の処理。入力値を取得し、result.htmlへ遷移する。
 */
function handleHomeSearch() {
    const selectedCity = document.getElementById('city-select').value;
    const addressInput = document.getElementById('address-input').value;
    const familySize = parseInt(document.getElementById('family-size').value, 10); // 数値として取得
    const durationDays = parseInt(document.getElementById('duration-days').value, 10); // 数値として取得

    if (!selectedCity || !addressInput || familySize <= 0 || durationDays <= 0) {
        // エラー通知はカスタムモーダルなどが望ましいが、今回はalertをそのまま使用
        alert("市町村、詳細住所、人数、日数を正しく入力してください。");
        return;
    }
    
    // ★★★ 修正: 成功した入力データをLocal Storageに保存 ★★★
    const profile = {
        city: selectedCity,
        addr: addressInput, 
        size: familySize,
        days: durationDays
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));


    // クエリパラメータを構築して画面遷移
    const query = new URLSearchParams({
        city: selectedCity,
        addr: addressInput,
        size: familySize,
        days: durationDays
    }).toString();

    window.location.href = `result.html?${query}`;
}

// ----------------------------------------------------
// 4. アプリケーションの起動
// ----------------------------------------------------

// DOMContentLoaded後に初期化関数を呼び出す
document.addEventListener('DOMContentLoaded', initHome);