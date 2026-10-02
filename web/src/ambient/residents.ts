/**
 * Pool 60 warga tetap dengan persona deterministik (NEXT_FEATURES 3.7). Murni, tanpa three.js/React,
 * supaya bisa di-unit-test dan dibake ke public/ambient/residents.json.
 */
import { playerLine, systemPrompt } from '../ai/promptFacts';
import { mulberry32 } from '../world/worldGen';
import { DISTRICT_NAMES, type DistrictId, districtOf, WORLD_CHUNKS } from '../world/worldSpec';
import { hourOf } from './density';

export const RESIDENT_COUNT = 60;
export const RESIDENT_SEED = 2026;

export interface Place {
  district: DistrictId;
  cx: number;
  cz: number;
}

export interface Resident {
  id: string;
  /** Nama tampilan dengan sapaan, mis. "Bu Wulan". */
  name: string;
  gender: 'm' | 'f';
  age: number;
  job: string;
  home: Place;
  office: Place;
  hobby: string;
  mood: string;
}

interface Job {
  title: string;
  /** Kegiatan saat jam kerja. */
  doing: string;
  district: DistrictId;
  ages: [number, number];
}

const JOBS: Job[] = [
  { title: 'pegawai bank', doing: 'bekerja di kantor bank', district: 'downtown', ages: [24, 55] },
  { title: 'barista', doing: 'meracik kopi di kafe', district: 'downtown', ages: [19, 32] },
  { title: 'pedagang bakso', doing: 'berjualan bakso keliling', district: 'downtown', ages: [25, 60] },
  { title: 'pegawai minimarket', doing: 'menjaga kasir minimarket', district: 'downtown', ages: [18, 35] },
  { title: 'satpam gedung', doing: 'berjaga di lobi gedung', district: 'downtown', ages: [25, 55] },
  { title: 'pengemudi ojek online', doing: 'mengantar penumpang', district: 'downtown', ages: [20, 50] },
  { title: 'guru SD', doing: 'mengajar di sekolah', district: 'residential', ages: [24, 58] },
  { title: 'pemilik warung', doing: 'menjaga warung di depan rumah', district: 'residential', ages: [30, 65] },
  { title: 'penjahit', doing: 'menjahit pesanan pelanggan', district: 'residential', ages: [28, 65] },
  { title: 'mahasiswa', doing: 'kuliah dan mengerjakan tugas', district: 'downtown', ages: [18, 23] },
  { title: 'pensiunan', doing: 'jalan-jalan di taman', district: 'residential', ages: [58, 75] },
  { title: 'operator pabrik', doing: 'bekerja di lini produksi pabrik', district: 'industrial', ages: [20, 50] },
  { title: 'sopir truk', doing: 'mengantar barang dari gudang', district: 'industrial', ages: [25, 55] },
  { title: 'mekanik bengkel', doing: 'memperbaiki motor di bengkel', district: 'industrial', ages: [20, 55] },
  { title: 'staf gudang', doing: 'menyusun barang di gudang', district: 'industrial', ages: [20, 45] },
];

const MALE = ['Agus', 'Bambang', 'Dedi', 'Eko', 'Fajar', 'Gilang', 'Hendra', 'Iwan', 'Rudi', 'Slamet', 'Teguh', 'Wahyu',
  'Yusuf', 'Bayu', 'Dimas', 'Rizky', 'Arif', 'Hadi', 'Imam', 'Kurniawan', 'Lukman', 'Nanang', 'Putra', 'Rahmat',
  'Sigit', 'Tono', 'Ujang', 'Yanto', 'Adi', 'Bagus', 'Cahyo', 'Danu'];
const FEMALE = ['Ani', 'Fitri', 'Indah', 'Lestari', 'Maya', 'Nur', 'Ratna', 'Siti', 'Tuti', 'Wulan', 'Yuni', 'Ayu',
  'Dian', 'Eka', 'Fransiska', 'Intan', 'Kartini', 'Lina', 'Mega', 'Novi', 'Puspita', 'Rini', 'Sri', 'Tika', 'Umi',
  'Vina', 'Winda', 'Yanti', 'Dwi', 'Endah', 'Galuh', 'Hesti'];
const HOBBIES = ['main badminton', 'memancing', 'memasak rendang', 'bersepeda pagi', 'main catur', 'menonton sepak bola',
  'merawat tanaman hias', 'karaoke dangdut', 'memelihara burung kicau', 'membaca novel', 'main gitar', 'fotografi',
  'jogging sore', 'menjahit', 'main futsal', 'mengoleksi batik'];
const MOODS = ['ceria', 'santai', 'lelah', 'sibuk', 'ramah', 'pendiam', 'bersemangat', 'agak murung', 'penasaran', 'humoris'];

const pick = <T>(list: readonly T[], random: () => number): T => list[Math.floor(random() * list.length)] as T;

function chunksOf(district: DistrictId): Place[] {
  const out: Place[] = [];
  for (let cz = 0; cz < WORLD_CHUNKS; cz++) {
    for (let cx = 0; cx < WORLD_CHUNKS; cx++) if (districtOf(cx, cz) === district) out.push({ district, cx, cz });
  }
  return out;
}
const CHUNKS: Record<DistrictId, Place[]> = {
  downtown: chunksOf('downtown'),
  residential: chunksOf('residential'),
  industrial: chunksOf('industrial'),
};

/** Sama seed -> 60 warga identik. Nama unik (diambil tanpa pengembalian). */
export function generateResidents(seed = RESIDENT_SEED): Resident[] {
  const random = mulberry32(seed);
  const names = { m: [...MALE], f: [...FEMALE] };
  return Array.from({ length: RESIDENT_COUNT }, (_, index) => {
    const gender = index % 2 ? 'f' : 'm';
    const pool = names[gender];
    const first = pool.splice(Math.floor(random() * pool.length), 1)[0] as string;
    const job = pick(JOBS, random);
    const age = job.ages[0] + Math.floor(random() * (job.ages[1] - job.ages[0] + 1));
    const title = age >= 40 ? (gender === 'm' ? 'Pak' : 'Bu') : gender === 'm' ? 'Mas' : 'Mbak';
    // Kebanyakan warga tinggal di Perumahan; sebagian kecil di rumah susun Pusat Kota.
    const home = pick(random() < 0.8 ? CHUNKS.residential : CHUNKS.downtown, random);
    return {
      id: `res_${String(index).padStart(2, '0')}`,
      name: `${title} ${first}`,
      gender,
      age,
      job: job.title,
      home,
      office: pick(CHUNKS[job.district], random),
      hobby: pick(HOBBIES, random),
      mood: pick(MOODS, random),
    };
  });
}

/** Kegiatan warga saat ini menurut jam dalam game (`dayClock.t`). */
export function residentActivity(resident: Resident, t: number): string {
  const hour = hourOf(t);
  const doing = JOBS.find((job) => job.title === resident.job)?.doing ?? 'bekerja';
  if (hour < 6 || hour >= 22) return 'beristirahat di rumah';
  if (hour < 8) return resident.job === 'pensiunan' ? 'olahraga pagi' : 'berangkat kerja';
  if (hour === 12) return 'makan siang';
  if (hour < 17) return doing;
  if (hour < 19) return resident.job === 'pensiunan' ? 'duduk-duduk di teras' : 'pulang kerja';
  return `bersantai, mungkin sambil ${resident.hobby}`;
}

const placeName = (place: Place) => DISTRICT_NAMES[place.district];

/**
 * System prompt warga, gaya sama dengan buildMessages di ai/chat.ts. `playerName` sudah divalidasi di profil.
 * `look` = appearanceSummary(appearance) dari pemanggil (dihitung di luar agar modul ini tetap murni).
 */
export function residentSystemPrompt(
  resident: Resident,
  t: number,
  playerName?: string,
  playerGender?: 'm' | 'f',
  look?: string,
): string {
  const persona =
    `Kamu adalah ${resident.name}, ${resident.age} tahun, ${resident.job} di Openworld City. ` +
    `Kamu tinggal di kawasan ${placeName(resident.home)} dan bekerja di kawasan ${placeName(resident.office)}. ` +
    `Hobimu ${resident.hobby}. Suasana hatimu hari ini ${resident.mood}. Saat ini kamu sedang ${residentActivity(resident, t)}.`;
  return systemPrompt(persona, playerLine(playerName, playerGender, look));
}
