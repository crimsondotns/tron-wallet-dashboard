# Tron Wallet Dashboard

Dashboard ติดตามกระแสเงินของ wallet บน Tron (TRX + TRC20) ดึงประวัติครบตั้งแต่รายการแรกของแต่ละ wallet

```
GitHub Actions (ทุก 10 นาที) ── ดึงจาก Tronscan ─► site/data/dashboard.json ─► GitHub Pages
        ▲ อ่านรายชื่อ Wallet + AddressBook                          │
        └──────────────── Google Sheet (GAS Web App) ◄──────────────┘ ตั้งชื่อ address / Export
```

| โฟลเดอร์ | หน้าที่ |
| --- | --- |
| `scripts/sync.mjs` | ดึงรายการจาก Tronscan (ใหม่ + ย้อนหลังจนหมด) จัดประเภท address แล้วเขียน `site/data/dashboard.json` |
| `.github/workflows/sync.yml` | รัน sync ทุก 10 นาที แล้ว deploy `site/` ขึ้น GitHub Pages |
| `site/` | หน้า Dashboard (`index.html`) + `gas-shim.js` ที่ทำให้หน้าเดิมอ่าน JSON แทน Apps Script |
| `gas/Code.gs` | โค้ดฝั่ง Google Apps Script: ส่งรายชื่อ wallet, บันทึก AddressBook, Export .xlsx/PDF |
| `data/state.json` | ตำแหน่งที่ดึงถึงแล้วของแต่ละ wallet (ให้รอบถัดไปทำต่อ) |

> **ข้อมูลเป็นสาธารณะ:** GitHub Pages เปิดให้ทุกคนที่มีลิงก์เห็นรายการ ชื่อ wallet และ AddressBook ทั้งหมด

## ติดตั้ง

### 1. Google Apps Script
1. เปิดโปรเจกต์ GAS เดิม วางโค้ดจาก `gas/Code.gs` ทับ `code.gs` (ใส่ API key จริงที่บรรทัด `setProperty('TRONSCAN_API_KEY', …)` เฉพาะใน GAS ห้าม commit)
2. **Project Settings → Script Properties → Add**: `EDIT_KEY` = รหัสที่ตั้งเอง (ใช้ตอนตั้งชื่อ address / Export จากหน้าเว็บ)
3. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
   - กด Deploy แล้วคัดลอก URL ที่ลงท้ายด้วย `/exec`
4. ทดสอบ: เปิด `<URL>?action=config` ในเบราว์เซอร์ ต้องเห็น JSON รายชื่อ wallet

### 2. GitHub
1. สร้าง repo ใหม่ (Public) แล้ว push โฟลเดอร์นี้ขึ้นไป
2. **Settings → Secrets and variables → Actions**
   - Secrets: `TRONSCAN_API_KEY` = API key ของ Tronscan
   - Variables: `GAS_URL` = URL `/exec` จากขั้นตอน 1.3
3. **Settings → Pages → Source: GitHub Actions**
4. แก้ `site/config.js` ใส่ `gasUrl` = URL `/exec` เดียวกัน แล้ว commit
5. **Actions → Sync & Deploy → Run workflow** (รอบแรกจะดึงประวัติทั้งหมด อาจใช้หลายรอบถ้าประวัติยาว รอบถัดไปทำต่อเอง)
6. เปิด `https://<username>.github.io/<repo>/`

### 3. ปิดการดึงข้อมูลใน GAS (หลัง GitHub ทำงานแล้ว)
ใน Apps Script Editor เลือกฟังก์ชัน `useGithubSync` แล้วกด Run ครั้งเดียว เพื่อลบ trigger `trackAll` / `backfillRun` ไม่ให้ใช้ API ซ้ำซ้อน

## ใช้งาน
- **เพิ่ม/ลบ wallet:** แก้ชีต `Wallet` ใน Google Sheet รอบ sync ถัดไปจะดึงประวัติของ wallet ใหม่ให้ครบเอง
- **ตั้งชื่อ address:** คลิก node ในกราฟ → ตั้งชื่อ → บันทึก (ครั้งแรกจะถามรหัส EDIT_KEY) ชื่อจะขึ้นบนหน้าเว็บหลัง sync รอบถัดไป
- **ดูความคืบหน้า:** แท็บ Actions → รอบล่าสุด → ขั้น "Fetch transactions from Tronscan"
- **รันในเครื่อง:** `TRONSCAN_API_KEY=… GAS_URL=… node scripts/sync.mjs`

## ข้อจำกัด
- GitHub อาจเลื่อนเวลารัน schedule ได้บ้างตอนคนใช้เยอะ และจะหยุด schedule ถ้า repo ไม่มีความเคลื่อนไหว 60 วัน (commit ข้อมูลจาก Actions นับเป็นความเคลื่อนไหว)
- ไม่รวมการโอน TRX ภายในสัญญา (internal transactions)
