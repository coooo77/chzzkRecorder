## 設定

### cookie

在 model 建立 cookie.txt 檔案，並依照下列格式新增 cookie

```txt
auth 的值
session 的值
```

### VOD 下載暫停

Windows 預設會為每個 VOD 開啟下載視窗，可在視窗查看 Streamlink 進度。按 `P` 後，再按 `Y` 確認暫停，或按 `N` 繼續下載。

確認暫停後，`model/vodDownloadList.json` 中的狀態會變成 `paused`，不會自動重試。要重新下載時，將狀態改成 `waiting`。重新下載會從頭開始，並覆寫原本的部分檔案。請使用 `P` 暫停；直接關閉視窗不會記錄為手動暫停。

若不需要下載視窗，可在 `config.json` 設定 `"showVodWindow": false`。
