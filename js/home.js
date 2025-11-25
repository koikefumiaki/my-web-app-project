// =====================================================================
// 愛知マイ備蓄ナビ - HOME画面ロジック (home.js)
// 役割: データのロード、市町村選択肢の生成、検索クエリの構築と画面遷移
// =====================================================================

// ----------------------------------------------------
// 1. 定数とグローバル変数の定義 (result.jsと共通)
// ----------------------------------------------------

const API_KEY = "AIzaSyAV0j-JNMRDpyvwk-6OxhpPzKLhG5fT9IE"; // ★★★ Google Maps APIキーに置き換えてください ★★★
const DATA_PATHS = {
    CITIES: '../data/aichi_cities.json', 
    HAZARD: '../data/hazard_data.json',   
    SUPPLY: '../data/supply_data.json',   
    SHELTER: '../data/shelter_list.json'  
};
let appData = {};

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

/**
 * 検索ボタンクリック時の処理。入力値を取得し、result.htmlへ遷移する。
 */
function handleHomeSearch() {
    const selectedCity = document.getElementById('city-select').value;
    const familySize = document.getElementById('family-size').value;
    const durationDays = document.getElementById('duration-days').value;

    if (!selectedCity || familySize <= 0 || durationDays <= 0) {
        // エラー通知はカスタムモーダルなどが望ましいが、今回はalertをそのまま使用
        alert("市町村、人数、日数を正しく入力してください。");
        return;
    }

    // クエリパラメータを構築して画面遷移
    const query = new URLSearchParams({
        city: selectedCity,
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