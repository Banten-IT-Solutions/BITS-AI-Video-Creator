const voiceover: Record<string, string> = {
  "voiceover.eyebrow": "Studio native",
  "voiceover.title": "Studio voiceover",
  "voiceover.description":
    "Pratinjau setiap adegan dengan mesin suara sistem, atau buat track suara yang bisa diunduh melalui provider TTS kompatibel OpenAI milik Anda sendiri.",
  "voiceover.editStoryboards": "Ubah storyboard",
  "voiceover.loadingProjects": "Memuat proyek voiceover…",
  "voiceover.emptyTitle": "Belum ada adegan untuk diisi voiceover",
  "voiceover.emptyDescription":
    "Buat storyboard terlebih dahulu. Setiap adegan dapat memiliki script voiceover, suara, tempo, serta audio hasil generate sendiri.",
  "voiceover.createStoryboard": "Buat storyboard",
  "voiceover.storyboardLabel": "Storyboard",
  "voiceover.discardConfirm": "Buang perubahan voiceover yang belum disimpan?",
  "voiceover.chooseStoryboard": "Pilih storyboard",
  "voiceover.sceneCount": "{count} adegan",
  "voiceover.loadingScenes": "Memuat adegan…",

  "voiceover.speechUnavailable": "Suara sistem tidak tersedia",
  "voiceover.speechUnavailableDetail":
    "Gunakan generate provider untuk membuat file audio sebagai gantinya.",
  "voiceover.nothingToPreview": "Tidak ada yang bisa dipratinjau",
  "voiceover.needLineDetail": "Tulis dulu baris voiceover untuk adegan ini.",
  "voiceover.previewStopped": "Pratinjau berhenti",
  "voiceover.previewStoppedDetail":
    "Mesin suara sistem tidak dapat menyelesaikan baris ini.",

  "voiceover.savedToast": "Voiceover tersimpan",
  "voiceover.savedToastDetail":
    "Script dan pengaturan suara disimpan bersama storyboard.",
  "voiceover.saveFailedToast": "Voiceover tidak dapat disimpan",

  "voiceover.nothingToGenerate": "Tidak ada yang bisa di-generate",
  "voiceover.ttsNotConfigured": "Provider TTS belum dikonfigurasi",
  "voiceover.ttsNotConfiguredDetail":
    "Tambahkan secret tts.api_key atau ai.api_key di Pengaturan.",
  "voiceover.audioFilter": "Audio {format}",
  "voiceover.generatedToast": "Voiceover selesai dibuat",
  "voiceover.generatedToastDetail": "{bytes} ditulis ke disk.",
  "voiceover.generateFailedToast": "Voiceover tidak dapat dibuat",

  "voiceover.assetRemovedToast": "Referensi audio dihapus",
  "voiceover.assetRemovedToastDetail":
    "File itu sendiri tidak diubah dan tetap ada di disk.",
  "voiceover.assetRemoveFailedToast": "Referensi audio tidak dapat dihapus",

  "voiceover.noLogline": "Belum ada logline.",
  "voiceover.unsavedBadge": "Belum disimpan",
  "voiceover.savedBadge": "Tersimpan",
  "voiceover.noScenes": "Storyboard ini belum memiliki adegan.",
  "voiceover.noScriptInList": "Belum ada script voiceover",
  "voiceover.saveVoiceover": "Simpan voiceover",

  "voiceover.generatedAudioTitle": "Audio hasil generate",
  "voiceover.generatedAudioDesc":
    "File yang dibuat melalui provider TTS Anda untuk storyboard ini.",
  "voiceover.refreshAudio": "Segarkan referensi audio",
  "voiceover.loadingAudio": "Memuat referensi audio…",
  "voiceover.noAudioYet":
    "Belum ada audio hasil generate. Generate provider membuat file di disk dan menyimpan referensinya di sini.",
  "voiceover.showInFolder": "Tampilkan file audio di folder",
  "voiceover.showFailedToast": "File audio tidak dapat ditampilkan",
  "voiceover.removeAudioRef": "Hapus referensi audio",
  "voiceover.removeAudioRefConfirm":
    "Hapus referensi audio ini? File tetap ada di disk.",

  "voiceover.sceneNumber": "Adegan {number}",
  "voiceover.noLocation": "Lokasi tidak ditentukan",
  "voiceover.scriptReady": "Script siap",
  "voiceover.noScriptBadge": "Belum ada script",
  "voiceover.scriptLabel": "Script voiceover",
  "voiceover.scriptHint": "{count}/8.000 karakter · disimpan bersama adegan",
  "voiceover.scriptPlaceholder":
    "Tulis baris persis seperti yang seharusnya diucapkan. Cukup pendek agar tetap luwes.",
  "voiceover.dialogueLabel": "Dialog dalam adegan ini",
  "voiceover.dialogueHint":
    "Salin sebuah baris ke kolom voiceover untuk mempratinjaunya dengan kontrol di bawah.",
  "voiceover.shotLabel": "SHOT {number}",

  "voiceover.previewTitle": "Pratinjau suara sistem",
  "voiceover.previewSubtitle": "Hanya putar lokal · tidak membuat file audio",
  "voiceover.unsupportedBadge": "Tidak tersedia di webview ini",
  "voiceover.systemVoices": "{count} suara sistem",
  "voiceover.voiceLabel": "Suara",
  "voiceover.systemDefaultVoice": "Bawaan sistem",
  "voiceover.rate": "Laju",
  "voiceover.pitch": "Nada",
  "voiceover.volume": "Volume",
  "voiceover.previewButton": "Pratinjau",
  "voiceover.resume": "Lanjutkan",
  "voiceover.pause": "Jeda",
  "voiceover.stop": "Hentikan",
  "voiceover.pausedStatus": "Dijeda",
  "voiceover.speakingStatus": "Berbicara",

  "voiceover.generateTitle": "Buat file audio",
  "voiceover.generateDesc1":
    "Menggunakan endpoint kompatibel OpenAI di Pengaturan. Provider harus mendukung",
  "voiceover.generateDesc2":
    ". Anda memilih file tujuan sebelum permintaan ke provider dikirim.",
  "voiceover.keyConfigured": "Key terkonfigurasi",
  "voiceover.noTtsKey": "Belum ada key TTS",
  "voiceover.generateFormat": "Generate {format}",
  "voiceover.configureTts": "Konfigurasi TTS",
  "voiceover.addSecretHint": "Tambahkan secret bernama tts.api_key atau ai.api_key.",

  "voiceover.selectSceneTitle": "Pilih sebuah adegan",
  "voiceover.selectSceneDesc":
    "Pilih adegan di sebelah kiri untuk menulis dan mempratinjau voiceover-nya.",
};

export default voiceover;
