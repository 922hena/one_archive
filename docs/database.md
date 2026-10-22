# YEAR SCORE — 데이터베이스 설계서 (Database Design)

> **Version:** 0.3.0 · PRD v0.6 연계 / 미사 음악 17슬롯·악보 Quick Add/연주용 버전·페달·시각·시드 후보 통합  
> **Status:** `PROPOSED` — 단, **1단계 범위는 2026-10-21 Supabase에 적용됨** (아래 §31 "1단계 구현 현황" 참조)  
> **기준 문서:** 프로젝트 최상위 `PRD.md` **v0.6.0** (v0.4 대비 추가 요구사항은 🟢/🔵로 식별)  
> **대상:** Cursor 개발 에이전트, YEAR SCORE 운영자  
> **언어:** 한국어 설명 + 영문 테이블명·컬럼명·기술 용어  
> **작성 원칙:** 요구사항을 데이터 관계와 검증 기준으로 해석한 **제안**이다. 현재 Supabase에 이 테이블들이 있다는 뜻이 아니다.

---

## 0. Cursor가 먼저 따라야 할 안전 규칙

**이 파일을 읽었다는 이유만으로 SQL을 실행하거나 Supabase를 변경하지 마라.**

1. **기존 회원가입/로그인 최우선 보존:** Supabase Auth의 `auth.users`, 회원 UID, Auth 설정, 리디렉션, 세션 처리 코드를 변경·삭제·재생성하지 않는다. `auth.users`는 Supabase가 관리한다.
2. **먼저 읽기 전용 점검:** 프로젝트 코드, 사용 중인 Supabase 프로젝트·스키마, 테이블·뷰·함수·RLS·스토리지 버킷·마이그레이션·환경변수 **키 이름**을 확인한다. 비밀값이나 사용자 개인정보는 출력하지 않는다.
3. 이전에 확인한 `public` 스키마 화면에는 테이블이 보이지 않았지만 **현재 DB 전체 상태는 미확인**이다. 실제 스키마 점검 없이 비어 있다고 단정하지 않는다.
4. 백업 및 복원 절차를 확인하고 **사용자 승인 전** 테이블 생성, 정책 수정, 마이그레이션, 파일 이동·삭제, 프로덕션 데이터 수정은 금지한다.
5. 새 테이블명과 컬럼은 **가칭**이다. 기존 코드와 이름이 다르면 기존 계약을 조사하고 차이를 보고한다. 임의로 대규모 이름 변경을 하지 않는다.
6. 실제 구현은 승인 후 **작은 단계의 마이그레이션 + RLS 테스트 + 기능 테스트**로 진행한다. 이 문서의 예시는 실행용 마이그레이션이 아니다.
7. `P0`는 초기 제품 필수, `P1`은 후속, `P2`는 장기 확장. `[TBD]`는 확정되지 않은 결정이다.

### 이 설계에서 절대 깨지면 안 되는 조건 (Invariants)

- `auth.users.id`가 개인 데이터 소유자를 식별하는 **유일한 기준**이다.
- 공통 전례력·검증된 작품 정보는 개인 미사/파일/연주 기록과 분리한다.
- **하나의 날짜에 여러 미사**를 생성할 수 있다. `user_id + date`에 유니크 제약을 두지 않는다.
- **한 악보를 한 번만 저장하고 여러 미사·템플릿·연습 목록에서 참조한다.** 연결 해제는 원본 파일 삭제가 아니다.
- 작품(`work_id`), 소유 악보(`owned_score_id`), 미사 곡 항목(`mass_music_entry_id`), 실제 연주 확인(`performance_confirmation_id`)은 다른 개체다.
- **연주 배정 횟수와 확인 연주 횟수는 다르다.** 템플릿 사용 횟수도 별개다.
- 다중 조건 검색은 AND이며, 전례 시기·전례 역할 등의 이력 조건은 **같은 미사 곡 사용 맥락**에서 판단한다.
- 한 사용자의 비공개 악보·통계를 다른 사용자에게 노출하지 않는다.
- 저작권 허가 없는 복음·복음 환호송 본문이나 저작권 보호 악보를 공통 데이터로 무단 복제·배포하지 않는다.
- **기준 미사 순서 0~32와 음악 선택 가능한 17개 슬롯은 분리**하고 사용자별 표시명/선택 구성을 원본과 분리한다.
- **연주용 편집본과 원본 파일 리비전은 다른 개체**다. 6쪽 PDF의 짧은 3쪽 버전 때문에 원본 파일을 복제하거나 작품을 중복 생성하지 않는다.
- **HID 블루투스 발 페달은 P0**이며 장치/키 매핑 설정은 사용자별 데이터로, 악보 페이지 넘김 로직과는 독립시킨다.
- **최초 저장 일시 불변, 마지막 사용자 편집 일시만 표시**, 앱 기본 폰트 Pretendard, 날짜 기본 `YYYY년 M월 D일(요일)`를 준수한다.
- **백엔드 구조의 복잡성은 UI에 강제 노출하지 않는다.** 기본 화면은 최소한의 행 요약과 클릭 시 상세 보기를 사용하고, 사용자 선택 이전부터 넉넉한 여백과 중립적인 현대적 디자인을 갖춘다.
- **콘텐츠 보기 설정과 시각 테마 설정을 분리**한다. 공통 디자인 기본값, 개인의 색상·폰트·대표 이미지 선택은 서로의 원본을 변경하지 않는다.

---

## 1. 데이터베이스 전체 구조 (Domain Map)

| 영역 | 소유권 | 핵심 목적 | PRD 연결 |
|---|---|---|---|
| 인증·권한 | Supabase Auth / 보안 관리자 | 기존 회원 보호 및 접근 통제 | `CORE-001` |
| 전례 기준 데이터 | 운영자 | 연도·날짜·지역별 전례일, 독서·복음 참조 | `LIT-*`, `GOS-*`, `ADM-*` |
| 미사 및 전례 맥락 | 개인 | 날짜별 복수 미사·특별 미사 | `MASS-*`, `SPC-*` |
| 작곡가·작품 | 검증된 공통 데이터 | 다국어·별칭·작품번호·학술 메타데이터 | `WORK-*`, `SRCH-002` |
| 전례 역할·성가 | 공통 + 개인 설정 | 전주/후주/영성체 후 묵상, 성가집별 번호 | `SRCH-001` |
| 악보·파일 | 개인 | 한 파일의 다중 연결, 판본, 보정·버전 | `SCORE-*`, `SCAN-*` |
| 미사 곡 순서·연주 증빙 | 개인 | 목차·실제 연주 여부·통계 | `MASS-*`, `HIST-*` |
| 템플릿·연습 목록 | 개인 | 재사용 가능한 곡 순서 | `TPL-*`, `SCORE-002` |
| 저장된 보기·검색 | 개인 | 표시 항목·순서·교집합 조건 재사용 | `VIEW-*`, `WORK-005`, `SRCH-*` |
| 화면 디자인·테마 | 운영자 기본값 + 개인 선택 | 간결한 기본 UI, 저장된 보기와 분리된 색상/폰트/대표 이미지 설정 | `UI-*` |

### 핵심 관계도 (개념도 — 실제 테이블은 아래 참조)

```text
auth.users
  ├── mass_events ──< mass_music_entries >── works >──< work_composers >── composers
  │                         │                 │                        └── composer_aliases
  │                         │                 ├── work_titles
  │                         │                 ├── work_catalogue_numbers
  │                         │                 └── work_liturgical_tags [P1/TBD]
  │                         ├── owned_scores ──< score_revisions ──< score_revision_pages
  │                         │       │                  └── score_assets (파일 메타데이터)
  │                         │       └── score_editions [optional]
  │                         └── performance_confirmations
  ├── mass_templates ──< template_music_entries >── works / owned_scores
  ├── practice_lists ──< practice_list_entries >── works / owned_scores
  ├── saved_views / saved_searches
  ├── user_ui_preferences ──(optional)── user_visual_assets (개인 대표 이미지)
  └── (나머지 개인 정보는 기존대로 독립)
  └── personal_special_liturgies

liturgical_observances ──< liturgical_readings
         │
         └──< mass_events (선택된 전례일, 또는 특별 전례 맥락)

liturgical_sources / content_licenses : 기준 전례 데이터의 출처·사용 권한
liturgical_roles : 미사 곡 항목의 전례 역할 표준 목록
hymnals ──< hymnal_entries >── works [optional, 곡 식별 체계 고려]
```

**다중 연결 구현 원칙:** `mass_music_entries.owned_score_id`, `template_music_entries.owned_score_id`, `practice_list_entries.owned_score_id`가 같은 `owned_scores.id`를 여러 번 가리킨다. 범용 `target_type/target_id` 폴리모픽 FK는 초기 단계에서 피하고, 각 연결 테이블에 **실제 외래키(FK)** 를 둔다.

---

## 2. 공통 컬럼·타입·명명 규칙

- 테이블·컬럼: 영어 `snake_case`, 복수형 테이블명(예: `mass_events`).
- 기본키: `id uuid primary key`; FK도 `uuid`. `auth.users.id`를 기존대로 참조한다.
- 사용자 소유 테이블: `user_id uuid NOT NULL references auth.users(id)`.
- 공통 시간: `created_at timestamptz`, `updated_at timestamptz`(DB에서 갱신).
- 단순 날짜는 `date`, 실제 시각은 `timestamptz`. 미사의 **현지 날짜 표시**를 위해 `local_date date`, `timezone text` 등도 별도 관리하는 방식을 검토한다. 날짜·요일 표시 규칙은 UI에서 `YYYY년 M월 D일(요일)`을 적용한다.
- 표시 제목/메모는 Unicode `text`, 정렬 순서는 `sort_order integer`, 금액·용량·페이지 수 등 수치는 적절한 정수형.
- 정해진 상태는 `CHECK` / 참조 테이블을 우선하고, 화면 구성·가변 옵션은 검증된 `jsonb`를 제한적으로 사용한다.
- `is_verified`만 두지 말고 `verification_status`, `verified_at`, `source_id` 등 **근거·상태**를 기록한다.
- **중복 방지용 UNIQUE**는 조심해서 설계한다. 예: 같은 날 같은 사용자의 미사는 여러 개 가능, 동일 곡이 한 미사에 두 번 나올 수 있음.
- 관리자만 수정하는 공통 데이터에는 누가 검증·수정했는지 감사 필드를 둔다.
- URL에 포함되는 **signed URL은 DB의 영구 파일 식별자가 아니다**. 스토리지 제공자, 버킷, 객체 키, 파일 해시 등의 안정적 메타데이터로 저장한다.

---

## 3. 인증과 권한 (Identity & Authorization) [P0]

### 3.1 `auth.users` — 기존 Supabase 관리 테이블 (생성·수정 금지)

- 새 앱 테이블의 `user_id` FK 기준: `auth.users.id`.
- 기존 이메일·비밀번호·리디렉션·가입 로직을 이 설계 때문에 재구현하지 않는다.
- `public.profiles`는 **필수 조건이 아니다**. 사용자 표시 이름 등 앱 전용 정보가 필요해졌을 때만, 실제 코드 확인 후 선택적으로 설계한다.

### 3.2 `app_admin_roles` — 관리자 권한 관리 [P0 최소]

| 컬럼(제안) | 의미 |
|---|---|
| `user_id uuid PK` | `auth.users.id` 참조 |
| `role text` | `admin`, `editor` 등 신뢰된 권한 |
| `granted_at timestamptz` | 권한 부여 일시 |
| `granted_by uuid` | 권한 부여자(필요시) |

- **브라우저에서 사용자가 자신의 관리자 역할을 수정할 수 없어야 한다.** 별도 비노출 스키마 또는 엄격한 권한으로 보호한다.
- 클라이언트가 수정 가능한 사용자 프로필 값이나 자기 작성 메타데이터를 관리자 권한의 근거로 삼지 않는다.
- 서버의 service-role 키는 브라우저에 절대 제공하지 않는다.

---

## 4. 전례력·독서·복음 (Liturgical Reference Data) [P0]

### 4.1 `liturgical_sources` — 기준 자료 출처

`id`, `name`, `publisher`, `source_url`, `locale`, `license_note`, `verified_at`, `verification_status`, `created_at`, `updated_at`.

- 자료의 **신뢰도 검증**과 **법적 사용 허가**는 다른 항목이다.
- 한국 천주교 기준·교구별 고유 전례 등은 출처와 적용 범위를 별도 기록한다.

### 4.2 `liturgical_observances` — 날짜별 전례일

| 컬럼(제안) | 타입 | 역할 |
|---|---|---|
| `id` | uuid PK | 전례일 식별자 |
| `calendar_date` | date NOT NULL | 전례력 날짜 |
| `scope_code` | text | 전국·교구·성당 등 적용 범위 구분 `[TBD]` |
| `locale_code` | text | 언어/지역, 예: `ko-KR` |
| `celebration_name_ko` | text | `연중 제30주일` |
| `season_code` | text | `advent/christmas/ordinary/lent/easter` |
| `color_code` | text | `green/white/violet/red/rose` + 예외 허용 |
| `rank_code` | text nullable | 주일/대축일/축일/기념일 등의 구분 |
| `source_id` | uuid FK | `liturgical_sources` |
| `verification_status` | text | `draft/reviewed/published` 등 |
| `verified_at`, `updated_at` | timestamptz | 검증·변경 이력 |

- 같은 날짜에 지역별 또는 특별 전례가 **복수로 있을 수 있으므로 `calendar_date` 단독 UNIQUE 금지**.
- 색상은 저장된 전례 자료의 `color_code`를 화면에서 `(녹)` 및 색상 점으로 표현한다. 기본 화면에 별도 전례색 설명란은 만들지 않는다.
- 날짜 형식은 DB에서 문자열로 저장하지 않고 `date`를 UI가 `2026년 10월 25일(일요일)`로 형식화한다.
- 이미 작성한 개인 미사의 역사적 문맥은 기준 전례일이 나중에 편집되더라도 원치 않게 바뀌지 않아야 한다(아래 이벤트 스냅샷 참조).

### 4.3 `liturgical_readings` — 전례 독서·환호송 참조

| 컬럼(제안) | 타입 | 역할 |
|---|---|---|
| `id` | uuid PK | 독서 항목 |
| `observance_id` | uuid FK | 연결된 전례일 |
| `reading_kind` | text | `first/second/gospel/acclamation` |
| `scripture_reference` | text nullable | 예: `루카 18,9-14` |
| `sequence` | integer | 당일의 표시 순서 |
| `content_license_id` | uuid nullable FK | 텍스트 사용권 |
| `licensed_text` | text nullable | **허용을 확인한 경우에만** 본문 저장 |
| `official_external_url` | text nullable | 적법한 공식 외부 열람 링크 |
| `source_id` | uuid FK | 근거 출처 |

- 제2독서가 없는 날에는 해당 `reading_kind` 항목이 없어도 된다.
- **복음 환호송의 문구와 복음 본문은 별도 사용 허가가 필요할 수 있다.** 참조와 원문 저장을 구분한다.
- 공개 사이트 URL을 안다고 해당 본문을 복사·스크래핑·내부 캐싱해도 되는 것은 아니다.

### 4.4 `content_licenses` — 전례 본문 사용 허가 [필수 정책 / 구현 P1]

`id`, `rights_holder`, `work_or_translation`, `permission_status`, `permitted_uses jsonb`, `attribution_text`, `start_at`, `end_at`, `proof_reference`, `reviewed_at`.

- 앱 내 표시, 다운로드, 오프라인 캐싱, 재배포, 상업적 이용 등을 **각각** 허락 조건으로 기록.
- 허가받지 않은 본문은 앱 내에서 제공하지 않고 검증된 외부 출처 연결 방식을 사용한다.

### 4.5 `personal_special_liturgies` — 개인 특별 전례 선택 [P0]

`id`, `user_id`, `title`, `kind`, `source_note`, `liturgical_basis_note`, `created_at`, `updated_at`.

- 개인이 만든 특별 전례 설정은 공통 `liturgical_observances`와 별도 보관한다.
- 개별 미사에 연결될 때 **공식 전례로 오인되지 않도록** `origin = personal_special` 등의 표시를 제공한다.
- **지역·교구의 검증된 특별 전례**는 원칙적으로 별도 범위의 운영자 공통 데이터에 포함할 수도 있으며, 적용 우선순위는 `[TBD]`.

---

## 5. 작곡가·작품·성가 정보 (Music Reference Data) [P0]

### 5.1 `composers` — 작곡가

`id`, `canonical_name`, `short_display_name`(예: `J. S. Bach`), `full_name`, `birth_year`, `death_year`, `historical_nationality`, `biographical_note`, `verification_status`, `source_reference`, `created_at`, `updated_at`.

- 출생·사망 정보에는 정확한 날짜가 확인되면 보조 날짜 필드를 둘 수 있다. 역사적 국적을 현대 국적으로 단정하지 않는다.
- UI의 **호버·길게 누르기·키보드 접근**에서 전체 이름/생몰년/국적을 볼 수 있게 한다. 이는 주로 UI 기능이나 DB에 필요한 필드가 있어야 한다.

### 5.2 `composer_aliases` — 별칭·다국어 이름

`id`, `composer_id FK`, `alias_text`, `language_code`, `alias_type`, `normalized_alias`, `created_at`.

- 예: `Bach`, `바흐`, `J. S. Bach`, `Johann Sebastian Bach` → 같은 `composer_id`.
- 정규화는 검색을 위한 보조 값이며, **표시 이름의 원문은 보존**한다.

### 5.3 `works` — 음악 작품

| 컬럼(제안) | 타입 | 역할 |
|---|---|---|
| `id` | uuid PK | 작품의 공통 식별자 |
| `original_title` | text | 원어 제목 |
| `original_language` | text nullable | 원어 언어 코드 |
| `parent_work_id` | uuid nullable FK | 악장/편곡/원작 등 관계 `[TBD]` |
| `era_code` | text nullable | 음악사 시대 |
| `style_code` | text nullable | 양식 |
| `form_code` | text nullable | 형식 |
| `key_tonic` | text nullable | 표준 조성 으뜸음(예: `D`) |
| `key_mode` | text nullable | `major/minor/other/unknown` |
| `composition_year_from/to` | integer nullable | 확정/추정 연도 범위 |
| `duration_seconds` | integer nullable | 예상 연주 시간 |
| `historical_context` | text nullable | 시대 배경 |
| `intended_instrument_note` | text nullable | 작곡가가 염두에 둔 악기와 근거 |
| `associated_organ_note` | text nullable | 역사적 관련 오르간과 근거 |
| `certainty_level` | text | 확실성 수준 |
| `verification_status`, `source_reference` | text | 검증·출처 |

- **‘실제 연주한 오르간’은 작품 자체의 고정 속성이 아니다.** 개인 연주 이벤트·기록에 저장한다.
- 편곡·이조 판본에서 조성이 다르면 원작의 `key_tonic/key_mode`만 검색해 잘못된 결과를 내지 않도록 `score_editions` 또는 편곡 작품 관계를 활용한다.
- `d minor`, `dm`, `라단조`를 검색할 때는 **정규화된 동일 조성**으로 매칭한다. `D major`는 포함하지 않는다.

### 5.4 `work_composers` — 작품·작곡가 연결

`id`, `work_id FK`, `composer_id FK`, `contribution_role`(`composer/arranger/attributed_to` 등), `is_primary`, `attribution_certainty`.

- 작품이 한 작곡가에게만 귀속된다고 가정하지 않는다. 논쟁 중인 귀속, 편곡자도 출처에 근거해 기록한다.
- 하나의 주요 작곡가 식별 방식과 중복 연결 정책은 초기 데이터 샘플로 검증한다.

### 5.5 `work_titles` — 작품명 번역·별칭

`id`, `work_id FK`, `title_text`, `language_code`, `title_type`(`english/korean/alternate/common` 등), `normalized_title`.

- 원어 제목(`works.original_title`)을 유지하고, 영어·한국어 이름은 여기서 연결한다.
- 작품명 동명이곡 방지를 위해 **제목 문자열만으로 작품을 식별하지 않는다**.

### 5.6 `work_catalogue_numbers` — 작품번호

`id`, `work_id FK`, `catalogue_prefix`(예: `BWV`, `Op.`), `catalogue_number`, `display_number`, `normalized_number`.

- `BWV 565`처럼 **정확한 작품번호 매칭을 검색의 최우선 기준**으로 삼는다.
- 작곡가·편집판·악장 번호와 작품번호의 충돌 가능성이 있으므로 무조건 전역 UNIQUE를 두지 않는다.

### 5.7 `liturgical_roles` — 전례 내 음악 역할

`id`, `code`, `label_ko`, `label_en`, `sort_order`, `is_active`.

- 예: `prelude`(전주), `postlude`(후주), `communion_meditation`(영성체 후 묵상), `entrance`(입당), `offertory`(봉헌), `communion`(영성체), `recessional`(파견).
- 같은 작품이라도 미사에 따라 역할이 달라질 수 있으므로 **역할은 `works`가 아닌 미사 곡 사용 항목에 기본 저장**한다.
- 동의어/표기 변경은 표준 `role_id`에 매핑하도록 설계한다. 역할 목록의 최종 명칭·범위는 `[TBD]`.

### 5.8 `hymnals` / `hymnal_entries` — 성가집별 성가번호

- `hymnals`: `id`, `title`, `edition`, `publisher`, `source_reference`.
- `hymnal_entries`: `id`, `hymnal_id FK`, `hymn_number`, `title`, `work_id FK nullable`, `source_reference`.
- **성가번호는 성가집과 함께 식별**한다. 예: 숫자 `271`만 전역에서 고유하다고 가정하지 않는다.
- 성가와 작품의 관계가 불명확한 경우 임의로 합치지 않는다.

### 5.9 `score_editions` — 공통 판본 메타데이터 [P0 최소]

`id`, `work_id FK`, `edition_title`, `editor_name`, `publisher`, `publication_year`, `edition_identifier`, `source_reference`.

- `score_editions`에는 **공통 판본의 서지정보**를 저장하고, 실제 업로드 파일은 사용자 전용 `owned_scores`에 둔다.

### 5.10 `work_liturgical_tags` — 선곡 적합성 후보 태그 [P1 / TBD]

`id`, `work_id FK`, `season_code`, `role_id FK nullable`, `tag_source_type`, `source_reference`, `verification_status`, `notes`.

- **사용자가 이 작품을 예전에 성탄에 연주했다는 기록**과 **이 작품이 성탄에 활용 가능하다는 검증/편집 태그**는 다른 데이터이다.
- 개인의 미연주 작품까지 `성탄 AND 연주 횟수 = 0`으로 검색하려면 이 구분이 중요하다. 출처 없는 AI 추정 태그를 공식 규정처럼 표시하지 않는다.

---

## 6. 미사 일정·음악 항목·특별 설정 [P0]

### 6.1 `mass_events` — 하나의 실제 미사/예식 일정

| 컬럼(제안) | 타입 | 역할 |
|---|---|---|
| `id` | uuid PK | 미사 일정 식별자 |
| `user_id` | uuid FK | 일정 소유자 |
| `local_date` | date | 현지 전례 날짜 |
| `start_at` | timestamptz nullable | 미사 시작 시각 |
| `timezone` | text | 예: `Asia/Seoul` (변경 가능) |
| `venue_name` | text nullable | 성당·장소 |
| `observance_id` | uuid nullable FK | 선택된 공통 전례일 |
| `personal_special_liturgy_id` | uuid nullable FK | 선택된 개인 특별 전례 |
| `season_code_snapshot` | text nullable | **당시 적용된 전례 시기** |
| `celebration_name_snapshot` | text nullable | 당시 전례일 명칭 |
| `color_code_snapshot` | text nullable | 당시 전례색 |
| `status` | text | `planned/completed/cancelled` 등 |
| `source_template_id` | uuid nullable FK | 템플릿 유래(있는 경우) |
| `notes` | text nullable | 개인 메모 |
| `created_at`, `updated_at` | timestamptz | 생성·수정 |

- **UNIQUE(`user_id`, `local_date`) 금지.** 같은 날짜의 오전·오후 미사를 별도 행으로 저장한다.
- 전례력 원본이 바뀌더라도 **과거 실제 미사에 적용한 시기·전례일 정보**를 보존할 수 있도록 스냅샷을 둔다. 사용자에게는 명시적 재적용 기능을 검토한다.
- 행 상태 `completed`는 이벤트가 끝났음을 뜻할 뿐 **각 곡을 실제 연주했다고 확정하지 않는다**.
- 역할·성가대 등 추가 메타데이터 필요 여부는 PRD 및 실제 앱의 기존 UI를 확인해 결정한다.

### 6.2 `mass_music_entries` — 미사 곡 목차의 한 줄

| 컬럼(제안) | 타입 | 역할 |
|---|---|---|
| `id` | uuid PK | 배정/사용 기록 식별자 |
| `user_id` | uuid FK | 소유자(접근 통제·검색용) |
| `mass_event_id` | uuid FK | 해당 미사 |
| `sort_order` | integer | 목차 순서 |
| `role_id` | uuid nullable FK | 입당·영성체 후 묵상·후주 등 |
| `work_id` | uuid nullable FK | 공통 작품 |
| `hymnal_entry_id` | uuid nullable FK | 성가집 항목(있다면) |
| `owned_score_id` | uuid nullable FK | 개인 악보 참조(재업로드 없음) |
| `pinned_score_revision_id` | uuid nullable FK | 특정 악보 버전 고정 시 사용 `[TBD]` |
| `display_title_override` | text nullable | 해당 미사에서만 쓰는 표기 |
| `notes` | text nullable | 해당 곡에 대한 미사별 메모 |
| `created_at`, `updated_at` | timestamptz | 기록 관리 |

- 같은 작품이 같은 미사에 **두 번** 사용될 수 있으므로 `mass_event_id + work_id` UNIQUE 금지.
- 악보가 아직 없어도 **곡 목차를 먼저 생성**할 수 있어야 한다.
- `user_id` 중복 보관은 RLS·검색 성능에 유리하나 **다른 사람의 `mass_event_id`나 `owned_score_id`를 연결할 수 없도록** 복합 FK/검증 로직으로 소유권 일치성을 강제해야 한다.
- 한 곡 항목에서 참조하는 악보와 작품이 서로 맞는지 검증한다. 편곡·이조 작품은 예외 정책 필요.
- 곡을 목차에서 제거할 때, 과거 확인된 연주 기록이 있다면 **이력 보존/보관 처리**를 우선하고 무작정 삭제하지 않는다.

### 6.3 특별 전례 맥락 관리

- 개별 미사에서 `observance_id`와 `personal_special_liturgy_id`를 어떤 우선순위로 사용할지 `[TBD]`.
- 사용자가 만든 특별 선택은 **그 미사에만** 적용하며 공통 전례일 데이터를 업데이트하지 않는다.
- 지역별 전례 차이에 따른 공식성 표시는 검증 출처와 분리·관리한다.

---

## 7. 악보 저장·재사용·페이지 편집 [P0/P1]

### 7.1 `owned_scores` — 사용자가 소유한 악보 논리 개체 [P0]

`id`, `user_id`, `work_id FK nullable`, `score_edition_id FK nullable`, `display_name`, `active_revision_id FK nullable`, `archived_at nullable`, `created_at`, `updated_at`.

- **`owned_scores.id`는 파일 경로와 달리 변하지 않는 논리적인 악보 ID**다.
- 미사·템플릿·연습 목록은 이 ID를 참조한다. 파일을 다시 업로드할 필요가 없다.
- 현재 파일 저장 제공자(Supabase Storage, Cloudflare R2 등)는 **실제 코드 확인 후 결정**. DB는 제공자와 분리된 논리 모델을 유지한다.
- 동일 작품에 사용자별 여러 악보(원본/편집판/다른 판본)를 가질 수 있다.

### 7.2 `score_revisions` — 악보의 저장 버전 [P0 최소 / P1 편집]

`id`, `owned_score_id FK`, `revision_number`, `revision_label`, `compiled_pdf_asset_id FK nullable`, `page_count`, `created_at`, `created_by`, `change_note`.

- 페이지 재촬영/교체 등 수정 시 **새 버전**을 생성하는 비파괴적 편집을 기본 제안한다.
- `owned_scores.active_revision_id`는 현재 기본 버전을 가리킨다.
- 기존 미사 연결이 최신 버전을 자동 참조할지, 연결 당시 `pinned_score_revision_id`를 유지할지는 **[TBD] 정책**이다. 선택 전 자동 갱신을 구현하지 않는다.
- 파일 삭제/정리는 어떤 버전·다른 연결에서 사용 중인지 확인한 후 진행한다.

### 7.3 `score_assets` — 실제 저장 파일의 메타데이터

| 컬럼(제안) | 역할 |
|---|---|
| `id` | 파일 자산 ID |
| `user_id` | 소유자 |
| `owned_score_id` | 연결 악보 |
| `storage_provider` | Supabase / R2 등 `[TBD]` |
| `bucket_name`, `object_key` | **영구 저장 위치 식별자** |
| `asset_type` | `original_photo`, `enhanced_page`, `compiled_pdf`, `preview` 등 |
| `mime_type`, `byte_size` | 형식·용량 |
| `checksum_sha256` | 무결성/중복 탐지 후보 |
| `width_px`, `height_px` | 이미지 특성 (선택) |
| `created_at`, `deleted_at` | 수명주기 |

- 대용량 PDF/JPG/PNG **바이너리를 PostgreSQL 테이블에 직접 넣지 않는다**. DB는 메타데이터를 관리하고 파일은 검증된 스토리지에 저장한다.
- 사용자마다 비공개 접근을 보장한다. 원본 삭제는 보정본/PDF 저장 여부·다른 버전 참조를 확인한 뒤 수행한다.
- signed URL은 생성 시점에 짧은 시간만 유효한 접근 수단이며, DB의 파일 ID가 아니다.

### 7.4 `score_revision_pages` — 페이지 순서/교체 이력 [P1]

`id`, `score_revision_id FK`, `page_number`, `page_asset_id FK nullable`, `source_asset_id FK nullable`, `source_pdf_page_number nullable`, `rotation_degrees`, `processing_settings jsonb`.

- 페이지 표현은 **이미지 자산** 또는 **기존 PDF의 특정 페이지 참조** 중 하나를 정확히 식별하도록 제약을 둔다.
- 예: 10페이지 악보의 5페이지만 다시 촬영 → 새 `score_revision`에 페이지 1~4, 6~10은 기존 자산을 참조하고 5만 새 자산을 참조한다. 새 PDF는 필요 시 다시 생성한다.
- `UNIQUE(score_revision_id, page_number)`로 버전 안의 페이지 순서 충돌을 막는다.
- 재사용하는 페이지 원본/자산을 **참조 중인 다른 버전이 있는데 삭제하지 않도록** 파일 수명주기를 관리한다.
- 원본 사진 용량과 결과 PDF 용량, 원본 삭제 선택은 별도로 제공한다. 최적 DPI·압축 방식은 실제 악보를 테스트해 결정한다.

### 7.5 비파괴 연결·삭제 정책

1. 미사에서 곡/악보 연결 해제 → `mass_music_entries`의 해당 참조만 변경(필요 시 이력 보존).
2. 템플릿의 곡/악보 연결 해제 → `template_music_entries` 참조만 변경.
3. `owned_scores` 삭제 요청 → 연결된 미사·템플릿·연습 목록·버전 수를 보여주고 삭제 범위를 명확히 확인.
4. 우선 `archived_at`을 이용한 **보관 처리**를 검토한다. 실제 바이너리 삭제는 참조 확인 및 승인 절차 후.
5. **자동 CASCADE로 사용자 악보 삭제가 과거 미사·연주 기록을 대량 삭제하게 만들지 않는다.** `RESTRICT`/명시적 삭제 절차를 우선한다.

---

## 8. 템플릿과 연습 목록 [P0]

### 8.1 `mass_templates`

`id`, `user_id`, `name`, `description`, `recurrence_rule jsonb`(또는 검증된 RRULE 텍스트 `[TBD]`), `usage_count_cached nullable`, `created_at`, `updated_at`.

- 반복: 매주, 매월 첫째/셋째 주일, 둘째/넷째 주일, 선택한 주차/날짜.
- 다섯째 주일·월 경계·예외일 처리 규칙은 별도 테스트가 필요하다.
- `usage_count_cached`는 성능 캐시일 뿐이며, 실제 **템플릿 적용 이력**에서 재계산 가능해야 한다.

### 8.2 `template_music_entries`

`id`, `user_id`, `mass_template_id FK`, `sort_order`, `role_id FK nullable`, `work_id FK nullable`, `owned_score_id FK nullable`, `pinned_score_revision_id FK nullable`, `notes`.

- 이 테이블도 `owned_scores.id`를 직접 참조하므로 같은 악보를 여러 템플릿에서 재사용한다.
- 템플릿 적용 시 **목차 스냅샷을 새 미사 곡 항목으로 복사**하되, 악보 바이너리는 복사하지 않는다.
- 미사에 적용한 후 템플릿을 수정해도 과거 미사의 곡 순서·메모가 저절로 변경되지 않는다.

### 8.3 `template_applications` — 적용 이력 [P0]

`id`, `user_id`, `mass_template_id FK`, `mass_event_id FK`, `applied_at`, `application_mode`, `result_note`.

- 템플릿 사용 횟수를 계산하는 근거. 한 미사에 템플릿을 여러 번 적용한 경우의 집계 원칙은 `[TBD]`.
- `source_template_id`와 이력 테이블 중 어떤 필드를 단일 사실 근거로 사용할지는 구현 전 정한다.

### 8.4 `practice_lists` / `practice_list_entries` — 개인 연습 목록 [P0 재사용 링크 / UI P1]

- `practice_lists`: `id`, `user_id`, `name`, `created_at`, `updated_at`.
- `practice_list_entries`: `id`, `user_id`, `practice_list_id FK`, `sort_order`, `work_id FK nullable`, `owned_score_id FK nullable`, `notes`.
- 미사 목차·템플릿과 마찬가지로 **원본 파일 복제 없이 기존 악보를 재연결**한다.

---

## 9. 연주 확인·횟수 집계 — 최중요 [P0]

### 9.1 용어를 정확히 분리한다

| 통계명 | 논리적 정의 | 자동 확정 가능? |
|---|---|---|
| `assigned_count` | 미사 곡 항목에 작품을 **배정한 건수**(계획 포함) | 배정 데이터로 계산 가능. 취소된 일정 포함 여부 `[TBD]` |
| `confirmed_performance_count` | 실제 연주했다고 **명시적으로 확인된 사용 건수** | **아니오. 확인 기록이 있어야 함** |
| `estimated_from_schedule_count` | 과거 미사 일정으로부터 추정한 사용 건수 | 추정치로만 표시. 확정 실적 취급 금지 |
| `distinct_mass_count` | 특정 작품이 사용된 **서로 다른 미사 수** | 집계 방식 지정 필요 |
| `template_usage_count` | 템플릿이 미사에 적용된 횟수 | 작품 연주 횟수와 별개 |

**핵심:** 과거 날짜의 미사로 자동 전환했다고 모든 배정곡을 `confirmed`로 표시하지 않는다. 이벤트가 `completed`여도 곡별 연주 확인은 별도다.

### 9.2 `performance_confirmations` — 확인된 실제 연주 사용

| 컬럼(제안) | 역할 |
|---|---|
| `id` | 연주 확인 ID |
| `user_id` | 확인 기록 소유자 |
| `mass_music_entry_id FK` | 실제 해당 미사의 **한 곡 사용 항목** |
| `performed_on` | 실제 연주한 날짜 |
| `confirmed_at` | 사용자가 확인한 시각 |
| `confirmation_source` | 사용자의 명시적 확인 등 |
| `performance_instrument_note` | 실제 연주한 오르간/악기(선택) |
| `revoked_at` | 실수로 확인한 경우 취소/정정 이력(선택) |

- **초기 정책 제안:** 1개의 미사 곡 항목은 최대 1개의 유효한 확정 기록을 갖는다(동일 곡을 두 번 사용했다면 서로 다른 곡 항목으로 기록). 수정을 위한 취소·재확인 이력은 별도로 보존한다. `[TBD]`
- 카운트는 `revoked_at IS NULL`인 유효한 확인 기록만 포함한다.
- 집계 시 해당 확인 기록과 **같은 `mass_music_entry_id`**의 `role_id`, `work_id`, 그리고 같은 미사의 `season_code_snapshot`, `local_date`를 읽는다.
- `performance_confirmations.user_id`와 참조하는 `mass_music_entries.user_id`는 반드시 같아야 한다.

### 9.3 사용자별 집계 기본 규칙

- 집계 단위 기본 후보: `works.id` + 로그인 사용자 `user_id`. 판본 단위/악보 단위는 별도의 선택 기준으로 제공 `[TBD]`.
- 미사 곡 항목이 같은 작품을 두 번 포함하면 **사용 건수 2**, 별개 미사 수는 **1**이 될 수 있다.
- 집계 기간 `전체 기간 / 선택 날짜 범위`를 선택한다.
- 역할·시기 필터와 결합된 횟수는 `전체 연주 횟수` 또는 `해당 조건 안의 연주 횟수`를 **명확히 구분**한다.
- 현재 사용자에게 **기록 자체가 없는 0회**와 다른 사용자의 비공개 기록을 확인할 수 없어 보이지 않는 경우를 섞지 않는다.

---

## 10. 교집합 검색 설계 — YEAR SCORE 최우선 [P0]

> **이 영역은 PRD `SRCH-001`~`SRCH-005`, `CORE-005/006/009`의 직접 구현 기준이다.** 별도 벡터 DB나 AI부터 구축하지 않는다.

### 10.1 지원할 검색 조건

| 분류 | 데이터 연결 | 검색 유형 |
|---|---|---|
| 작곡가 | `composers`, `composer_aliases`, `work_composers` | 원어/한글/약칭/오타 보정 |
| 작품명 | `works`, `work_titles` | 원어·영어·한국어·통용명 |
| 작품번호 | `work_catalogue_numbers` | 정확 일치 최우선 |
| 음악사 시대 | `works.era_code` | 같음/다중 선택 |
| 형식·양식 | `works.form_code/style_code` | 같음/다중 선택 |
| 조성 | `works.key_tonic/key_mode` | 동의어 정규화 |
| 전례 시기·전례일 | `mass_events` 스냅샷, 전례 기준정보 | 과거 사용 맥락 또는 선곡 후보 태그 `[TBD]` |
| 전례 역할 | `mass_music_entries.role_id` | 과거 실제 배정/연주 맥락 |
| 성가집·번호 | `hymnals`, `hymnal_entries` | 성가집 + 번호 |
| 개인 악보 보유 | `owned_scores.user_id/work_id` | 보유/미보유 |
| 배정·확인·추정 횟수 | `mass_music_entries`, `performance_confirmations`, `mass_events` | `<=`, `>=`, `=`, 범위, **0회** |
| 날짜·장소 | `mass_events` | 날짜 범위·장소(선택) |

### 10.2 AND의 의미와 가장 위험한 오류

- 기본적으로 서로 다른 필터들은 **AND**. 동일 필드의 복수 선택은 UI 정의에 따라 내부 OR가 될 수 있으므로 분명히 명세한다.
- 예 A: `시기=성탄 AND 확인 연주 횟수<=2`.
- 예 B: `역할=영성체 후 묵상 AND 조성=D minor AND 확인 연주 횟수<=3`.
- **이력 필터의 일치 단위는 같은 사용 기록**이다. 잘못된 예: 작품을 2024년 성탄에는 *전주*로 사용하고 2025년 연중에는 *영성체 후 묵상*으로 사용했는데, 이를 근거로 ‘성탄 + 영성체 후 묵상’ 공연이 있었던 것으로 반환하는 오류.
- 집계 타입과 범위를 검색 결과에 표시한다. 예: `확인 연주 2회 (성탄 시기 내)` vs `확인 연주 5회 (전체)`.
- 비교 연산자는 정확히 `이하(≤)`, `이상(≥)`, `같음(=)`, `범위(min..max)` 지원. UI에서 0 입력 허용.
- 같은 작품의 **여러 미사 곡 항목**이 나와도 잘못된 조인 중복으로 횟수가 부풀지 않아야 한다(`COUNT DISTINCT` 대상 결정 또는 집계 선행).

### 10.3 0회 검색의 ‘모집단’ 문제 [중요 TBD]

- `성탄에 실제 연주한 적 있는 작품 AND 그 시기 확인 연주 0회`는 논리적으로 충돌한다.
- 사용자의 진짜 의도가 `성탄에 어울리는 작품 중 내가 연주한 적 없는 곡`이라면 **전례적 적합성 태그 또는 후보 목록**이 따로 필요하다.
- 따라서 UI에서 다음 개념을 구분한다.
  1. **이력 기반 검색:** 실제 저장된 특정 전례 맥락의 배정·연주 기록을 찾는다.
  2. **작품 후보 검색:** 작품 자체의 검증된 전례 활용 태그를 기준으로 후보를 고르고, 그 작품의 **개인 연주 횟수(0 포함)** 를 필터링한다.
- 어떤 모드를 기본으로 쓸지, 개인 기록만으로 성탄 후보를 제안해도 될지, 편집자가 확인한 태그를 누가 관리할지 **사용자 승인으로 결정**한다. AI가 추정한 전례 적합성을 확정 사실로 표시하지 않는다.

### 10.4 검색 쿼리의 논리적 처리 순서 (실행 SQL이 아닌 의사코드)

```text
INPUT: current_user, keyword, season, role, key, count_type,
       count_operator, count_min/max, count_scope, date_range, source_mode

1. 공통 작품 검색 후보를 조회한다.
   - 작품번호 정확 일치 > 정규화 작품명 > 작곡가/별칭 > 유사 문자열.
2. 작품 고정 속성 필터를 적용한다 (예: 조성 D minor, 바로크).
3. 사용자가 선택한 source_mode를 확인한다.
   - history_mode: 권한이 있는 본인 기록에서 동일 미사 곡 항목의
     season+role+date 등을 함께 확인한다.
   - candidate_mode: 검증된 작품 태그를 통해 전례 후보 작품을 정한다.
4. 작품별 사용자 사용 기록을 별도로 집계한다.
   - assigned: 개인 미사 곡 항목 수
   - confirmed: 유효한 performance_confirmations 수
   - estimated: 명확히 표시한 과거 일정 추정치
5. count_scope = contextual 이면, 집계 대상 각 행이 같은 season+role+date 조건을
   모두 만족하도록 제한한다. global 이면 문맥과 무관한 전체 횟수를 계산한다.
6. 기록이 없는 작품도 기준 후보 집합에서 LEFT JOIN/COALESCE로 0을 유지한다.
7. 사용자 지정 <= / >= / = / between 조건으로 필터한다.
8. 모든 다른 필터와 AND 결합 후, 정확 일치/관련성 순으로 정렬한다.
9. 작품명·작품번호·작곡가·자료유형 + 횟수 타입·범위를 표시한다.
10. 클릭 시 보유 악보 → 미사/템플릿/연습 목록에 연결한다.
```

- Postgres 전문 검색은 언어별 형태소 처리 품질이 다르므로 한국어/독일어/프랑스어 작품명의 검색 정확도는 **별칭·정규화·테스트 데이터로 검증**한다.
- `pg_trgm`, Full-Text Search, 접두어 검색, 부분 문자열 검색은 실측 비교 후 단계적으로 적용한다. 별도 벡터 DB/AI는 P2.
- 필터값으로 SQL을 문자열 연결하지 않는다. **매개변수화된 쿼리 또는 검증된 RPC**로 안전하게 실행한다.

### 10.5 검색 인덱스 후보 (실제 실행 전 EXPLAIN으로 확인)

| 후보 | 목적 |
|---|---|
| `mass_events(user_id, local_date)` | 개인 미사 날짜/기간 찾기 |
| `mass_events(user_id, season_code_snapshot, local_date)` | 사용자별 전례 시기 검색 |
| `mass_music_entries(user_id, work_id, mass_event_id)` | 작품별 개인 사용 기록 집계 |
| `mass_music_entries(mass_event_id, sort_order)` | 미사 목차 표시 |
| `mass_music_entries(user_id, role_id, work_id)` | 전례 역할 교집합 |
| `performance_confirmations(user_id, mass_music_entry_id)` | 확정 연주 집계 |
| `owned_scores(user_id, work_id)` | 작품별 개인 보유 악보 |
| `work_catalogue_numbers(normalized_number)` | 작품번호 정확 검색 |
| `composer_aliases(normalized_alias)` | 작곡가 별칭 |
| `work_titles(normalized_title)` | 다국어 작품명 |
| Full-Text/GIN 또는 trigram 인덱스 | 이름·제목 오타/부분 검색 (검증 후) |

- 인덱스는 실제 쿼리·데이터량·쓰기 비용을 보고 선정한다. **모든 후보를 처음부터 무조건 생성하지 않는다.**
- 개인 통계 캐시/집계 테이블이 필요하면 **원본 사용 기록에서 재계산할 수 있어야 하고**, 사용자별 분리·갱신·무효화 정책을 테스트한다. 초기에는 실시간 집계부터 검증한다.

---

## 11. 보기 설정과 저장된 검색 [P0/P1]

### 11.1 `saved_views` — 화면 표시·순서 개인화

`id`, `user_id`, `view_type`(`liturgical_calendar`, `work_detail`, `search_results`), `name`, `is_default`, `layout_config jsonb`, `schema_version`, `created_at`, `updated_at`.

- 전례일 이름·색상은 UI 불변 필드이며, 사용자 `jsonb` 구성에서 숨기려 해도 앱이 무시한다.
- 입력 JSON은 허용된 필드 ID와 순서만 받도록 **서버에서도 검증**한다.
- 사용자마다 `최소/기본/상세/사용자 지정` 보기를 여러 개 가질 수 있다.
- 작품 상세 페이지에도 사용자가 선택한 메타데이터만 표시할 수 있다.

### 11.2 `saved_searches` — 반복 검색 [P1]

`id`, `user_id`, `name`, `filter_config jsonb`, `filter_schema_version`, `created_at`, `updated_at`.

- `성탄 AND 확인 연주 2회 이하` 같은 검색을 저장·재사용할 수 있다.
- `count_type`, `count_scope`, `count_operator`, `source_mode`, `season`, `role`, `key` 등을 명확한 값으로 저장한다.
- 프론트엔드에서 만든 JSON을 그대로 동적 SQL에 삽입하지 않는다.

### 11.3 `admin_form_layouts` — 운영자 편집 화면 설정 [P1]

`id`, `form_type`, `layout_config jsonb`, `schema_version`, `updated_by`, `updated_at`.

- **입력 폼 배치**를 바꿔도 기준 전례력의 실제 데이터가 삭제/변경되지 않는다.
- 관리자 외 수정 불가. 신규 필드(사용자 정의 필드)는 별도의 검증된 스키마·입력 정책 결정 후 도입한다.

---

### 11.4 기본 UI는 데이터 모델과 분리된 표시 계약 [P0, `UI-001`~`UI-007`]

- 데이터베이스에는 **충분한 작품·전례·연주 메타데이터**를 정확히 보관하되, 화면 목록에는 기본적으로 **한 행 = 핵심 요약**만 표시한다. 상세 내용은 선택 시 펼쳐 보거나 상세 화면에서 요청한다.
- `saved_views`는 **어떤 정보 필드를 보이고 어떤 순서로 배치할지**만 담당한다. 예: `liturgical_calendar`, `work_detail`, `search_results`, `mass_setlist` 등. `layout_config`는 허용된 필드 ID·표시 순서·접기 상태 등의 제한된 스키마로 검증한다.
- **초기 기본 보기(운영자 기준)는 이미 간결하게 정의**한다. 사용자가 복잡한 화면을 숨겨야만 단순해지는 설계는 피한다.
- 저장된 보기에 표시되지 않은 데이터도 DB에서 지우지 않는다. 핵심 필수 전례 정보는 숨길 수 없다.
- 구체적인 행 높이·간격·폰트 크기·토글 애니메이션·반응형 디자인은 `docs/architecture.md` 또는 향후 디자인 시스템에서 결정한다. DB에 CSS 위치나 픽셀 단위 수치를 과도하게 넣지 않는다.

### 11.5 `user_ui_preferences` — 사용자별 시각 디자인 설정 [P0 확장 준비 / UI 구현 P2]

> 아래는 **예정된 테이블 설계안**이며 현재 존재하거나 생성되었다는 뜻이 아니다. 기존 사용자 설정 테이블이 있으면 먼저 조사한 후 병합 가능성을 검토한다.

| 컬럼(제안) | 타입 | 목적 |
|---|---|---|
| `user_id` | uuid PK / FK `auth.users.id` | 이 계정의 디자인 설정, 기본 1행 |
| `theme_preset_key` | text nullable | 관리자가 승인한 기본/라이트/다크 등의 테마 키 |
| `background_color_token` | text nullable | 승인된 배경색 토큰 또는 사전 검증된 색상 값 |
| `font_family_key` | text nullable | 제공 가능한 폰트 목록의 키(임의 CSS 불가) |
| `landing_hero_asset_id` | uuid nullable FK | 개인 첫 화면 이미지 참조 (`user_visual_assets.id`) |
| `schema_version` | integer | 설정 형식 변경 시 호환성 관리 |
| `updated_at` | timestamptz | 마지막 수정 시각 |

- **Null은 '운영자 기본값을 따른다'는 의미**다. 사용자가 아무것도 고르지 않아도 디자인이 온전하게 작동해야 한다.
- DB는 폰트의 식별 키만 보관한다. 실제 폰트 파일·라이선스·로드/최적화 정책은 별도로 관리한다. 검증되지 않은 임의 폰트 URL·CSS·스크립트 입력을 금지한다.
- `background_color_token`은 미리 승인된 팔레트 키가 기본이다. 사용자 자유 색상 선택을 지원할 경우 정규화된 컬러 코드와 텍스트 대비 검사 정책을 별도 정의한다.
- 전례력·검색·미사·악보의 본문 정보와 검색 인덱스는 이 개인 디자인 설정에 의존하지 않는다.
- `landing_hero_asset_id`에 연결하는 개인 이미지의 소유자가 같은 `user_id`인지 **DB/서버 양쪽에서 검증**한다. 다른 사용자의 이미지 ID를 설정하지 못하게 한다.
- 사용자 설정을 삭제/초기화해도 작품, 미사, 악보, 전례력은 변하지 않는다.

### 11.6 `user_visual_assets` — 개인 첫 화면 이미지 파일 메타데이터 [P2 기능 / 초기 구조 고려]

| 컬럼(제안) | 타입 | 목적 |
|---|---|---|
| `id` | uuid PK | 이미지 식별자 |
| `user_id` | uuid FK | 이미지 소유자 |
| `purpose` | text | 예: `landing_hero` (용도 제한) |
| `storage_provider`, `bucket`, `object_key` | text | 비공개 파일 위치 식별자 |
| `mime_type` | text | 허용 이미지 MIME 검사 |
| `width_px`, `height_px`, `byte_size` | integer/bigint | 처리·용량 관리 |
| `status` | text | `pending/ready/deleted/rejected` 등의 상태 |
| `created_at`, `deleted_at` | timestamptz | 추가·삭제 시각 |

- 이미지는 DB에 큰 바이너리로 직접 넣지 않고 **스토리지에 저장**, DB에는 안정적인 객체 식별자만 보관한다.
- 이미지 업로드 시 허용 형식·용량·크기, 실제 파일 타입, 메타데이터, 접근권한을 검사한다. 불필요한 메타데이터 제거와 이미지 리사이즈·WebP/AVIF 등 최적화 형식은 실제 기기 지원을 확인해 적용한다.
- 기본 랜딩 이미지인 **silver ball**은 앱의 **공통 기본 자산**으로 보존한다. 사용자가 이미지를 바꾸더라도 원본 파일을 덮어쓰지 않는다. 현재 실제 자산 경로/존재 여부는 소스코드 확인 전 `[TBD]`.
- 개인 이미지가 없거나 삭제되거나 로딩에 실패하면 **안전하게 silver ball 기본 이미지로 복귀**한다.
- 개인 이미지는 원칙적으로 본인용이며 RLS/스토리지 권한을 적용한다. 홈 화면이 공개될 경우 공개 여부 및 허용 범위를 별도 제품 결정으로 다룬다.
- 스토리지 보관 비용과 삭제 정책은 **악보 파일의 소유·삭제 정책과 독립**시킨다.

### 11.7 운영자 공통 디자인 기본값 (Default Appearance) [P0 기본 / 운영 UI P2]

- 공통 기본 테마, 허용 팔레트, 폰트 키, 기본 silver ball 자산은 초기에는 **코드의 버전 관리된 디자인 토큰(Design Tokens)** 으로 관리하는 것을 우선 추천한다. 모든 디자인 값을 DB 테이블로 옮길 필요는 없다.
- 운영자가 앱 화면에서 기본 디자인을 변경해야 할 단계가 오면 `app_ui_defaults` 등의 **선택적 테이블**을 도입할 수 있다. 이때는 관리자 권한만 편집할 수 있고 변경 이력을 남긴다.
- 표시 우선순위는 **사용자별 유효한 설정 → 운영자 지정 기본값 → 앱에 포함된 안전한 기본값**이다. 설정 누락·지원 중단된 폰트·이미지 삭제에도 앱이 깨지지 않아야 한다.
- `saved_views` = **정보 종류와 순서**, `user_ui_preferences` = **색상·폰트·대표 이미지**, `app_ui_defaults`/디자인 토큰 = **운영자가 지정하는 시작 화면**으로 책임을 나눈다.
- 반응형 레이아웃, 넉넉한 여백, 목록 한 줄 요약·클릭 후 상세 보기, 미사 모드의 가독성은 **프론트엔드 구현 규칙**이며, DB 테이블에 사용자별 반복 데이터로 저장하지 않는다.

---

## 12. RLS·스토리지·보안 설계 [P0]

### 12.1 기본 접근 권한 매트릭스

| 데이터 | 익명(로그아웃) | 로그인 일반 회원 | 운영자 |
|---|---|---|---|
| 공개된 검증 전례일·작품 | 공개 범위 `[TBD]` | 검증 자료 조회 | 생성·수정·검증·공개 |
| 미사·미사 곡·템플릿 | 접근 불가 | **본인 행만 CRUD** | 일반 사용자 데이터 기본 조회 불가 (지원 목적 예외 별도) |
| 개인 악보·파일·스캔 이미지 | 접근 불가 | **본인 자료만** | 임의 접근 금지, 명시된 지원 절차만 |
| 확인된 연주·개인 통계 | 접근 불가 | **본인 기록만** | 타인 통계를 임의 열람하지 않음 |
| 개인 보기·저장된 검색 | 접근 불가 | 본인 자료만 | 기본 공개/설정값만 관리 |
| 관리자 설정·권한·라이선스 | 접근 불가 | 접근 불가 | 승인된 관리자만 |

### 12.2 필수 RLS 원칙

1. 클라이언트 접근 스키마의 모든 테이블에 접근 목적에 맞는 **GRANT + RLS + 정책**을 설정하고 각각 검증한다.
2. 개인 테이블에서 `user_id = auth.uid()`라는 소유권 검사를 기본으로 한다. 단, **그것만으로 다른 사람의 FK ID 연결을 막을 수 없는 경우** 복합 FK·검증 제약을 추가한다.
3. `SELECT/INSERT/UPDATE/DELETE`를 별도로 검토한다. `UPDATE`에는 기존 행·수정 후 행 모두 소유권 제한을 둔다.
4. 관리자 판정은 **사용자에게 수정 권한이 없는 신뢰된 근거**를 사용한다.
5. 모든 개인 관계 테이블의 `user_id`, FK, 조회조건에 맞는 인덱스를 고려한다.
6. 사용자 데이터가 포함된 **SQL View/Materialized View/RPC**가 RLS를 우회하지 않는지 점검한다. 필요시 `security_invoker`·비노출 스키마·서버 검증 방식 사용.
7. Supabase `service_role`은 RLS를 우회하므로 서버 비밀로 관리한다. 브라우저·Git 저장소·클라이언트 환경변수에 노출 금지.
8. **테스트 사용자 A/B**를 만들어 서로의 미사·악보·통계·설정에 접근/검색/수정이 실패하는지 확인한다.

### 12.3 파일 스토리지 (Provider TBD)

- **비공개 저장소**가 기본. Supabase Storage를 쓴다면 private bucket + `storage.objects` RLS; R2를 쓴다면 이에 상응하는 서버측 접근 제어를 구현한다.
- 객체 키 예시: `users/{user_id}/scores/{owned_score_id}/revisions/{revision_id}/{asset_id}.pdf` (개념 예시, 실제 파일 경로는 확인 후 결정).
- 다른 사용자의 객체 키를 알아도 다운로드할 수 없어야 한다.
- 서버에서 발급한 **시간 제한 URL**은 재발급 가능해야 하고, 개인정보가 담긴 파일을 공개 버킷에 두지 않는다.
- **오프라인 기능 주의:** 서명 URL 자체를 영구 캐시하지 않는다. 유효한 권한 확인을 거쳐 허용된 악보 바이너리를 기기 로컬에 저장하고, 로그아웃·계정 전환·공용 기기·브라우저 데이터 삭제 상황의 정책을 별도 수립한다.
- DB 백업과 파일 스토리지 백업은 별도 범위다. 원본·변환 PDF·버전·삭제 복구 정책을 운영 전에 검증한다.

---

## 13. 적용 단계 및 마이그레이션 제안 (실행 금지: 검토용)

| 단계 | 작업 | 승인 전 산출물 |
|---|---|---|
| **Phase 0** | 현행 코드/DB/스토리지·Auth·백업 읽기 전용 점검 | 현황 비교표, 위험·복원 계획 |
| **Phase 1A** | 공통 참조 테이블: 전례일·출처·작곡가·별칭·작품·역할·성가 | 관계/제약/시드 자료 검증 계획 |
| **Phase 1B** | 개인 미사·곡 항목·확인 연주·템플릿·소유권 RLS | A/B 접근 차단 테스트, 통계 테스트 |
| **Phase 1C** | 악보 논리 ID·버전·파일 메타·다중 연결 | 1파일-여러 연결·삭제 영향 테스트 |
| **Phase 2** | AND 검색, 집계 종류/범위, 0회 처리, 저장된 보기 | PRD `AT-012`~`AT-019` 테스트 |
| **기본 UI 설계(병행)** | 초기부터 한 줄 요약·상세 펼치기·여백 규칙을 적용, 디자인 설정 스키마 확장 준비 | `UI-001`~`UI-007`, `AT-022`~`AT-023` 검토 |
| **Phase 3** | PDF 뷰어·오프라인 다운로드 | 오프라인 준비·연속 페이지·실기기 검증 |
| **Phase 4** | 스캔·페이지 교체, 관리자 폼 구성 | 비파괴 버전·복구·용량 검증 |

> **실제 코드 없이 무작정 마이그레이션 SQL을 생성해 즉시 실행하지 말 것.** 단계별로 기존 Auth 회귀 테스트, 백업, RLS 정책 테스트, 롤백 계획을 확인하고 사용자 승인 후 시행한다.

---

## 14. 필수 검증 시나리오 (Database Acceptance Tests)

| Test ID | 테스트 입력 | 통과 기준 | 대응 PRD |
|---|---|---|---|
| DB-001 | 사용자 A/B 기존 계정 | `auth.users`·로그인 흐름 변경 없이 개인 FK 참조 가능 | `CORE-001` |
| DB-002 | A가 같은 날짜에 미사 2개 생성 | 두 이벤트 ID가 다르고 각각 독립 수정 | `MASS-001` |
| DB-003 | A가 B의 악보 ID를 자신의 미사에 연결 시도 | FK/정책 검증으로 실패 | `CORE-006`, `SCORE-003` |
| DB-004 | 동일 악보를 미사 2개·템플릿 2개·연습 목록에 연결 | 실제 원본 파일 1개, 연결 다수 | `SCORE-002` |
| DB-005 | 미사 1개에서 악보 링크 해제 | 다른 링크 및 원본 악보는 그대로 | `SCORE-004` |
| DB-006 | 10페이지 버전에서 5페이지만 교체 | 나머지 페이지·이전 버전·다른 참조 보존 | `SCAN-003`, `SCAN-004` |
| DB-007 | 계획 미사 3건 + 실제 확인 1건 + 취소 1건 | 배정/확인/추정 횟수를 서로 다르게 산출하며 취소를 확인으로 오인하지 않음 | `HIST-002/003` |
| DB-008 | 한 미사에 같은 곡 2번 배정·확인 | 사용 건수 2회, 별개의 미사 수 1회 | `HIST-004` |
| DB-009 | `성탄 AND 확인 횟수 ≤ 2` | 선택된 집계 범위에 맞는 결과와 횟수 표시 | `SRCH-003` |
| DB-010 | `영성체 후 묵상 AND D minor AND 확인 횟수 ≤ 3` | 조건을 동시에 만족하는 작품만 표시 | `SRCH-003` |
| DB-011 | 성탄에서는 전주, 연중에는 영성체 후 묵상으로 사용한 동일 작품 | `성탄 AND 영성체 후 묵상`을 **허위 교집합으로 판정하지 않음** | `SRCH-003`, `AT-016` |
| DB-012 | 확인 0회 작품·횟수 ≥0 / =0 / 0~2 | 0회와 부등호 경계를 정확히 처리 | `SRCH-003` |
| DB-013 | `Bach`·`바흐`·`J. S. Bach`·`BWV 565` | 동일 작곡가 별칭 및 정확 작품번호 검색 | `SRCH-002` |
| DB-014 | A와 B가 같은 공통 작품을 각자 사용 | A의 통계에는 B의 연주 횟수 미반영 | `HIST-005` |
| DB-015 | 성탄의 미사 1개와 같은 날짜의 별도 미사 1개 | 각각 독립 전례 맥락과 곡 기록 유지 | `CORE-002`, `SPC-001` |
| DB-016 | 관리자 전례력 수정 및 사용자 저장된 보기 변경 | 일반 회원은 공통 원본 수정 불가, 숨김은 데이터 삭제 아님 | `ADM-002`, `VIEW-003` |
| DB-017 | 파일 접근 권한 없는 사용자 다운로드 시도 | 악보 파일·서명 URL 발급 거부 | `CORE-006` |
| DB-018 | 허가 없는 복음 본문 데이터 입력/게시 시도 | 공식 원문 저장·표시 없이 참조/적법 링크만 사용 | `GOS-002~004` |
| DB-019 | 신규 계정에서 개인 디자인 값 없음 | 기본 간결한 보기, 운영자 기본 색상·폰트·silver ball로 정상 표시 | `UI-001~004`, `UI-008` |
| DB-020 | A만 배경색·폰트·첫 화면 이미지를 변경 [향후] | A 계정 설정에만 반영, B 및 운영자 공통값 불변 | `UI-007~010` |
| DB-021 | A가 B의 이미지 ID를 자신의 대표 이미지로 저장 시도 [향후] | 소유권 검증에서 거부, 다운로드 권한도 없음 | `UI-009`, `CORE-006` |
| DB-022 | A의 개인 대표 이미지를 삭제하거나 로딩 실패 [향후] | DB 참조는 무효화/정리, 기본 silver ball로 복귀, 다른 미디어 데이터 보존 | `UI-009` |
| DB-023 | 사용자가 보기에서 상세 필드를 숨김 | 검색·작품 DB 값은 그대로 남고 상세 확장 및 필수 전례 정보 접근 가능 | `UI-002`, `UI-006`, `VIEW-003` |

**테스트 데이터는 전용 개발 환경 또는 격리된 테스트 계정에서 사용**하고 실제 운영 미사 기록·회원 데이터를 훼손하지 않는다.

---

## 15. Cursor에게 보고받을 결정 사항 (TBD / Decision Log)

| 중요도 | 아직 미확정인 결정 | 현재 추천·관점 |
|---|---|---|
| **최우선** | 현행 프로젝트의 DB·Auth·스토리지 실제 상태 | 읽기 전용 점검 후 확정 |
| **최우선** | 0회+성탄 검색에서 ‘과거 사용 이력’ vs ‘전례 활용 후보’ | **모드 구분 추천**, 자동 적합성 판정 금지 |
| **최우선** | 연주 횟수의 기본 집계 범위·단위 | 사용자에게 `확인/배정/추정`, `전체/조건 내`, `사용 건수/미사 수` 명시 |
| **높음** | 확인 연주를 어떤 사용자 동작으로 기록할지 | 미사 후 곡별 확인 UI 추천 |
| **높음** | 소유 악보 수정 시 링크가 최신본을 볼지 고정본을 볼지 | 비파괴 리비전 + 선택 가능한 고정 정책 추천 |
| **높음** | 저장 파일 제공자, 백업·복구·원본 보관 | 기존 서비스 점검과 비용 비교 후 결정 |
| **높음** | 공통 작품의 동명·편곡·악장 식별 기준 | 출처와 작품번호 검증, 임의 병합 금지 |
| 보통 | 전례 시기별 가이드 및 전례 활용 태그 편집 정책 | 공식 규정/편집 의견/개인 기록 구분 |
| 보통 | 한국어 본문·환호송의 저작권 허가 | 허가 전 참조/외부 링크로 진행 |
| 보통 | 성가집별 번호 식별, 전례 역할 표준 목록 | 대표 실데이터로 확인 |
| 보통 | 관리자 필드 레이아웃·커스텀 필드 | 편집 화면 구성과 기준 DB 컬럼 분리 |
| 보통 | 기본 디자인 팔레트/폰트의 승인 목록, 최소 가독성 | 코드 디자인 토큰 우선, 검증된 설정 키만 DB에 저장 |
| 보통 | silver ball 이미지 실제 위치, 개인 이미지 파일 제한·보관/삭제 | 실제 프로젝트 자산 조사 후 개인 스토리지와 별도 처리 |

---

## 16. Cursor에 처음 요청할 작업 (Read-only Prompt)

```text
PRD.md v0.6.0과 docs/database.md v0.3.0을 읽어줘.

database.md는 아직 실행하지 않은 데이터베이스 설계안이야.
먼저 현재 프로젝트와 Supabase의 실제 상태를 읽기 전용으로 점검해서
(1) 이미 존재하는 테이블·컬럼·관계·RLS·Storage,
(2) 이 설계안과의 차이,
(3) 인증·회원정보 및 운영 데이터에 대한 위험,
(4) SRCH-003의 같은 맥락 AND 검색과 0회 집계 전략,
(5) SCORE-002~004의 파일 재사용·비파괴 연결 전략,
(6) 단계별 마이그레이션·테스트·롤백 계획,
(7) UI-001~UI-010의 기본 간결 화면과 사용자별 색상/폰트/첫 화면 이미지 설정을 향후 도입할 수 있는 구조
을 한국어로 보고해 줘.

비밀값은 절대 출력하지 말고, Supabase Auth 설정·auth.users·
실제 데이터·파일을 변경하지 마. 마이그레이션 SQL을 실행하지 마.
내 승인을 기다려.
```

---

## 17. PRD 요구사항 → DB 설계 추적표 (Traceability Matrix)

> **추가 참고:** v0.4 이후 `RITE-*`, `COMP-*`, `QUICK-*`, `SV-*`, `TURN-*`, `TIME-*`, `TYPE-*` 요구사항은 18~30장의 확장 설계 및 26장 연결표와 함께 검토한다.

> 구현 여부가 아니라 **설계안에서 참조해야 할 위치**다. UI 전용 요구사항은 관련 데이터 구조 또는 검증 항목만 연결하고 화면 구현은 `docs/architecture.md`에서 구체화한다.

| PRD 요구사항 | 해당 설계 영역 | 확인 사항 |
|---|---|---|
| `CORE-001`, `CORE-006` | §3, §12 | 기존 Auth 보호, 계정별 접근권한 |
| `CORE-002`, `MASS-001`, `MASS-005` | §6 | 동일 날짜 복수 미사 및 독립성 |
| `CORE-003`, `CORE-004`, `LIT-001`~`LIT-005` | §4, §11 | 운영자 전례력, 날짜 표시, 필수 명칭·색상 |
| `GOS-001`~`GOS-004` | §4.3~4.4 | 독서·복음 참조, 라이선스별 본문 제공 |
| `ADM-001`~`ADM-004` | §3, §4, §11.3 | 운영자 권한과 편집 레이아웃 분리 |
| `SPC-001`~`SPC-003` | §4.5, §6.3 | 개별 미사 특별 전례, 공통 원본 보호 |
| `VIEW-001`~`VIEW-004`, `WORK-005` | §11.1 | 개인별 표시 항목·정렬·저장된 보기 |
| `UI-001`~`UI-010`, `CORE-012`~`CORE-013` | §11.4~11.7, §12 | 기본 UI의 간결함, 콘텐츠 보기/테마 분리, 사용자 이미지 소유권·기본 이미지 복원 |
| `MASS-002`~`MASS-004`, `CORE-008` | §6.2, §7, §8 | 곡 목차·악보 참조·연주 모드 연결 |
| `TPL-001`~`TPL-004` | §8 | 반복 규칙, 목차, 적용 이력·횟수 |
| `WORK-001`~`WORK-004`, `WORK-006` | §5 | 작품·작곡가·판본·별칭·확실성 |
| `SCORE-001`~`SCORE-006`, `CORE-007` | §7, §8 | 파일 1개 다중 연결, 비파괴 삭제·버전 선택 |
| `SCAN-001`~`SCAN-007`, `CORE-010` | §7.2~7.4, §13 | 페이지 교체·원본 삭제·비용·버전 관리 |
| `PERF-001`~`PERF-005`, `CORE-011` | §6~§8, §12.3 | 다음 곡 참조 및 오프라인 자산·성능 검증 |
| `HIST-001`~`HIST-005`, `CORE-009` | §9 | 배정·확인·추정·미사 수 분리 |
| `SRCH-001`~`SRCH-005`, `CORE-005` | **§10** | 다국어 검색, AND·같은 맥락·0회·개인 집계 |
| `SRCH-006` | §10.4, §15 | AI 의미 검색은 P2, 필수 검색보다 후순위 |
| `GUIDE-001`~`GUIDE-003` | §11, §15 | 초보자 설명은 선택형, 출처 유형 구분; 콘텐츠 테이블 추후 확정 |

---

## 참고 문서 (설계 근거)

- **제품 요구사항 기준:** `PRD.md` v0.6.0 (`CORE-*`, `LIT-*`, `WORK-*`, `SCORE-*`, `MASS-*`, `HIST-*`, `SRCH-*`).
- **Supabase RLS:** https://supabase.com/docs/guides/database/postgres/row-level-security
- **Supabase Storage 접근 제어:** https://supabase.com/docs/guides/storage/security/access-control
- **Supabase private buckets:** https://supabase.com/docs/guides/storage/buckets/fundamentals

---

## 🟢 18. v0.4 이후 추가된 기준 미사 순서와 음악 슬롯 [P0] — PRD `RITE-*`

> **설계 상태:** 전례 순서와 라틴어 명칭의 완전한 공식 검증은 아직 이루어지지 않았다. **PRD 부록 A는 사용자 초기안**이다. 기준 자료를 검증 전 공통 `published` 상태로 선언하지 않는다.

### 18.1 `rite_templates` — 운영자 관리 미사 유형별 기본 순서

`id uuid PK`, `rite_code text unique`, `name_ko text`, `name_la text`, `description`, `version integer`, `status enum(draft,reviewed,published,retired)`, `source_id FK`, `verified_at`, `created_at`, `updated_at`.

- 사용자가 직접 수정하지 않는다. 주일/평일/혼인/장례 등의 변형은 별도 `rite_template` 또는 규칙으로 구별한다.
- 전례력/지역 규정에 따라 조건부 슬롯의 존재를 명시하되, DB만으로 모든 전례 적합성을 자동 판단한다고 가정하지 않는다.

### 18.2 `rite_items` — 0~32번의 기준 예식 항목

`id uuid PK`, `rite_template_id FK`, `sequence_no integer`, `canonical_code text`, `title_ko`, `title_la`, `is_music_configurable boolean`, `is_optional boolean`, `kind enum(rite,musical_insert,optional_music)`, `applicability_rule jsonb nullable`, `source_id`, `verification_status`, `created_at`.

- 초기 데이터 `sequence_no=0..32` **33개**, 음악 설정 가능 번호는 **정확히 17개**: `0,1,4,5,8,11,15,16,19,21,22,23,25,26,27,31,32`.
- `UNIQUE(rite_template_id, sequence_no)`; `UNIQUE(rite_template_id, canonical_code)`.
- **주의 #16 `봉헌성가`, #26 `성체성가`, #0 전주, #32 후주**는 전례 예식 구조의 고정 요소와 동일한 수준의 공식 행위로 간주하지 않는다. `kind` 및 `canonical_code`로 역할을 구별하고, 실제 공식 예식 ID에 음악 삽입 지점을 매핑한다.
- #15 기본 화면명은 `보편 지향 기도`. 사용자 별칭을 바꿔도 `canonical_code`는 유지.
- 원본 순서 개정 시 `rite_templates.version`과 항목 버전을 관리하여 **과거 저장된 미사 목차를 무단 재배열하지 않는다.**

### 18.3 `liturgical_roles` 재사용 / `rite_item_roles` 매핑

기존 `liturgical_roles`의 표준 역할 ID를 **새로 중복 생성하지 않는다**. 필요한 경우 `rite_item_roles(rite_item_id, liturgical_role_id, default_sort_order, source_id)`로 연결한다.

- `role_id`는 검색 AND 조건과 확인 연주 기록 집계에서 **공식 불변 키**.
- 음악 역할이 아닌 기도/환호처럼 사용자가 음악을 붙이기로 한 슬롯도 `role_id`로 일관되게 매핑하되 사용자의 자유 텍스트를 집계의 기준으로 삼지 않는다.

### 18.4 `user_mass_layouts`, `user_mass_layout_items`, `mass_music_slots`

- `user_mass_layouts(id, user_id, name, rite_template_id, is_default, created_at, updated_at)` — 사용자의 저장된 기본 구성.
- `user_mass_layout_items(id, user_id, user_mass_layout_id, rite_item_id, liturgical_role_id, enabled, user_label_ko, user_label_la, user_label_en, custom_label, display_order)` — 사용자별 음악 슬롯 선택/표시명. `enabled`는 실제 미사에서 노출 여부이며 운영자 기준 데이터 변경이 아님.
- `mass_music_slots(id, user_id, mass_event_id, rite_item_id nullable, liturgical_role_id, label_snapshot, display_order, custom_slot boolean, created_at, updated_at)` — **미사별 슬롯 스냅샷**. 한 기준 슬롯 아래 0~N개의 `mass_music_entries`를 연결할 수 있다. 같은 역할을 분리해 여러 번 쓰는 경우도 지원한다.
- `mass_music_entries.mass_music_slot_id FK nullable` 추가 제안. 기존 `role_id` 필드는 계속 표준 검색/집계 기준이며, 이관 완료 후 완전성 규칙을 검증한다.
- `template_music_slots(id, user_id, mass_template_id, rite_item_id nullable, liturgical_role_id, label_snapshot, display_order)` — 개인 템플릿의 슬롯 스냅샷. 필요하면 기존 `template_music_entries`와 연결.
- **같은 사용자 소유임을 복합 FK `(user_id, parent_id)` 및 UNIQUE 제약 또는 인증된 서버 함수/RLS로 보장**한다. 단순 `user_id` 프론트엔드 전달값만 신뢰하지 않는다.
- **무결성 테스트:** 사용자 A가 자신의 슬롯명 `Communio`를 `성체성가`로 바꾸어도 작품 집계상 역할은 불변이고 사용자 B의 설정은 변하지 않는다.

## 🟢 19. 전역 촬영/파일 업로드, Quick Save 및 악보 미분류 [P0] — `QUICK-*`, `ENTRY-*`

### 19.1 기존 `owned_scores`의 필수 확장

- `work_id uuid nullable`: **초기 곡명/작곡가 미입력** 허용. 기존 Work를 찾지 못해도 `owned_scores` 저장 가능.
- `provisional_title text nullable`, `classification_status enum(unclassified,linked,needs_review)`, `source_method enum(camera,file_import,mixed)`, `capture_context_type nullable`, `capture_context_id nullable` **등은 제안**, 실제 입력 경로는 이벤트 로그와 연결 레코드로 정규화해도 됨.
- 개인 레퍼토리에서 미분류 악보를 **작품 메타데이터가 없는 개인 악보 카드/행**으로 보여준다. 검증되지 않은 `works` 마스터 레코드를 자동 생성하지 않는다.
- `score_assets.asset_type`에 `original_pdf`, `original_photo`, `enhanced_page`, `compiled_pdf`, `preview` 등 허용값을 검토하고 허용 MIME/파일 크기/보안 스캔을 수행한다.

### 19.2 `score_upload_jobs` — 저장 과정 상태 및 멱등성

`id uuid PK`, `user_id FK`, `owned_score_id nullable FK`, `idempotency_key text`, `source_method`, `status enum(pending,uploading,processing,ready,failed,abandoned)`, `error_code nullable`, `retry_count`, `created_at`, `completed_at`.

- **동일 사용자의 동일 `idempotency_key`는 UNIQUE**. 중복 저장 클릭/네트워크 재시도 방지.
- `ready`는 DB 자산/스토리지 존재·접근권한 확인 후에만 표시한다. 단순 브라우저 미리보기와 업로드 완료를 혼동하지 않는다.
- 모바일/태블릿의 시스템 카메라 권한 요청은 웹 앱 조작 횟수와 별도로 관리.
- 미사 내 슬롯에서 시작한 작업은 서버가 컨텍스트 소유권 확인 후 `mass_music_entry`(또는 슬롯의 새 entry)를 생성·연결한다. **업로드+연결 작업을 가능한 범위에서 트랜잭션·재시도 안전하게 처리**한다.

### 19.3 전역 단축 버튼·작품 자동완성

- 화면 어디서든 `+ 악보 추가`로 진입하며 촬영/업로드를 각각 지원한다. 작품·작곡가 선택은 **선택사항**.
- `composer_aliases`와 `work_titles`는 정규화된 검색 키 및 자동완성 색인으로 사용한다. 한 글자 검색 시 반환 건수 제한/우선순위와 debounce를 둔다.
- 화면의 작은 입력 폼이나 두 번 클릭 규칙 자체는 프론트엔드 조건이다. DB는 미분류 저장, 재시도, 나중에 상세 편집 가능한 모델을 제공한다.

## 🟢 20. 원본 리비전과 연주용 편집본을 분리 [P0] — `SV-*`

> **중요:** 기존 7장의 `score_revisions`는 **실제 악보 원본/편집 결과의 파일 리비전**. 아래 `score_performance_versions`는 **기존 버전의 페이지 일부를 선택해서 연주하는 논리적 연주용 편집본**. 두 개념을 동일 테이블로 합치지 않는다.

### 20.1 `score_performance_versions`

`id uuid PK`, `user_id uuid FK`, `owned_score_id uuid FK`, `source_score_revision_id uuid FK`, `display_title text NOT NULL`, `purpose_note text nullable`, `estimated_seconds integer nullable`, `is_default boolean`, `created_at timestamptz`, `last_edited_at timestamptz nullable`, `archived_at timestamptz nullable`.

- `(user_id, owned_score_id)` 소유자 일치. 편집본 삭제/비공개 보관은 원본 바이너리를 삭제하지 않는다.
- 초기 예시: `Prelude — D. Bédard`, `Prelude — D. Bédard (1)`, `Prelude — D. Bédard (2)`; 실제 곡/작곡가의 확인 없이 예시를 공식 작품 마스터로 등록하지 않는다.

### 20.2 `score_performance_version_pages`

`id uuid PK`, `user_id`, `performance_version_id FK`, `page_order integer NOT NULL`, `score_revision_page_id FK`, `note nullable`, `UNIQUE(performance_version_id,page_order)`.

- 원본 리비전의 페이지를 참조하여 **1~3쪽**, **1,2,5,6쪽** 등 페이지 선택/순서를 저장한다. 재사용해도 원본 파일은 한 번만 보관.
- 선택한 `score_revision_page_id`가 반드시 `score_performance_versions.source_score_revision_id`에 속하는지 **DB/서버에서 검증**한다. 교차 사용자/임의 파일 ID 연결 차단.
- 페이지 내부 마디 단위 잘라내기는 `start_anchor/end_anchor` 등 확장 여지를 남기되 **초기에는 정확한 음악 인식 구현을 주장하지 않는다**.

### 20.3 미사·템플릿·연습 목록의 정확한 버전 연결

- `mass_music_entries.score_performance_version_id nullable FK`, `template_music_entries.score_performance_version_id nullable FK`, `practice_list_entries.score_performance_version_id nullable FK`를 추가한다.
- 무결성: `version.owned_score_id = entry.owned_score_id`, 버전 소유자 = 미사/템플릿/연습 항목 사용자, 버전의 `source_revision_id`는 해당 원본 악보 리비전이다.
- 기록/집계는 **미사의 곡 사용 항목 ID를 기준**으로 하며, 편집본/파일 연결 개수 자체는 연주 횟수가 아니다.
- 원본 악보의 새 리비전이 나와도 기존 연주용 편집본은 **고정된 source revision**을 가리킨다. 사용자 승인 후 새 리비전을 기준으로 편집본을 갱신하도록 후속 편집 가능.

## 🟢 21. 사용자 저장/수정 시각과 날짜 포맷 [P0] — `TIME-*`, `TYPE-*`

### 21.1 `owned_scores` 타임스탬프 권고

| 필드 | 의미 | 제약/보안 |
|---|---|---|
| `created_at timestamptz NOT NULL DEFAULT now()` | 처음 **서버에 저장 확정**된 시각 | **일반 사용자/클라이언트 UPDATE 금지**, DB trigger 등으로 불변 유지 |
| `last_edited_at timestamptz NULL` | 최초 저장 후 **가장 최근에 성공한 사용자 수정** | 최초 등록 때 NULL. 내용·페이지·제목·메타데이터의 확정 수정 시 서버가 갱신. 앱 상태 폴링/동기화로 갱신 금지 |
| `updated_at timestamptz NULL` (필요 시) | 시스템 메타데이터 변경 추적 | 사용자용 최종 수정과 **혼동 금지** |

- 악보 최초 저장이 **서버 저장 확정 시점**이 되도록, 업로드 중인 항목은 `score_upload_jobs`에 보관하고 `owned_scores` 본 레코드는 성공 후 생성하는 방안을 우선 검토한다. 선등록 방식이라면 별도 `saved_at`을 두어 `created_at` 의미를 혼동하지 않는다.
- 파일 업로드 원본 완료 시간은 별도의 `score_assets.created_at` 등에서 구별할 수 있다.
- **출력 예:** 숨긴 기본 상태에서 `파일 세부정보` 한 줄, 펼치면 `최초 저장 2026년 10월 21일(수요일) 18시 40분`, `최종 수정 수정 기록 없음`, `파일 PDF · 6페이지`.
- **DB는 UTC 기반 timestamptz**, 화면에는 사용자 선택 시간대(기본 표시는 한국 기준 테스트)로 변환하며 `2026년 10월 21일(수요일)` 형식을 기본 지원. 날짜는 사용자 프레젠테이션 설정이며 검색 날짜/정렬 DB 키가 아님.
- 변경 이력 복구용 리비전은 별도 관리하되, **UI에는 최종 수정 1건만 보인다**.

### 21.2 사용자별 글꼴/날짜·시간 표시 설정

기존 `user_ui_preferences`의 `font_family_key` 기본값/설정 누락은 `pretendard`로 해석한다. 허용 목록 밖의 폰트 ID/임의 링크 거부.

- `user_format_preferences(user_id uuid PK, date_format_key text NOT NULL DEFAULT 'ko_full_weekday', time_format_key text NOT NULL DEFAULT 'ko_24h', timezone_name text NOT NULL DEFAULT 'Asia/Seoul', updated_at timestamptz)` **선택형 1:1 테이블 제안**. 기존 사용자 프로필에 이미 같은 속성이 있으면 중복 테이블을 만들지 말고 조사 후 통합.
- `ko_full_weekday` 포맷 정확한 출력: `2026년 10월 21일(수요일)`; 시각까지: `2026년 10월 21일(수요일) 18시 40분`.
- 국적 등 검색용 마스터 데이터와 날짜 표현 토큰은 무관하다.

## 🔵 22. 연주 모드 다중 입력/블루투스 HID 발 페달 [**P0 최우선**] — `TURN-*`

### 22.1 `user_page_turn_settings` — 1인 다중 프리셋

`id uuid PK`, `user_id uuid FK`, `name text`, `preset_kind enum(solo,helper,pedal,custom)`, `is_default boolean`, `button_size_token text`, `previous_button_position jsonb`, `next_button_position jsonb`, `show_buttons boolean`, `tap_zone_config jsonb`, `swipe_enabled boolean`, `key_mapping jsonb`, `schema_version integer`, `created_at`, `updated_at`.

- `key_mapping` 허용 동작은 `previous_page`, `next_page`, `previous_piece`, `next_piece` 등 **화이트리스트**, 허용 키는 `ArrowLeft/Right`, `PageUp/Down`, `Space` 등. 임의 자바스크립트/임의 SQL 입력 금지.
- 버튼 `position`은 디바이스 크기에 따라 범위/안전 영역 검증. 저장된 화면 좌표가 태블릿 회전 뒤 화면 밖으로 밀려 조작 불능이 되지 않도록 **정규화 좌표 또는 anchor+offset** 사용을 권장한다.
- 적어도 `solo`, `helper`, `pedal` 프리셋을 제공. `pedal`에서도 터치 대안을 완전히 제거하지 않는다.
- 실제 **Bluetooth 페어링은 운영체제 책임**. 웹 앱에는 HID 키보드 입력 이벤트가 들어오면 공통 페이지 이동 로직을 호출. 별도 블루투스 하드웨어 제어 API를 필수로 가정하지 않는다.
- 기기별 장치/브라우저 호환성 **실측 전 '지원 확정' 표기 금지**. 스캔 파일 오프라인 로딩과 페달 입력의 독립성을 검증한다.

### 22.2 RLS/성능/오프라인

- 설정 레코드는 본인 소유만 CRUD. 잘못된 키맵을 DB에 저장하지 않도록 JSON 스키마/서버 검증을 적용.
- 앱은 선택한 미사의 악보 **페이지와 성능 최적화된 미리보기**를 로컬에 미리 보관할 수 있어야 하며, 네트워크가 꺼진 뒤에도 키 입력으로 넘김 동작이 성공해야 한다.
- 외부 원격 도우미/카메라 윙크는 `P1/P2` 별도 실험 기능. 웹/PWA의 잠금·카메라·백그라운드 제약을 조사한다.

## 🟢 23. 작곡가 30명·한 글자 자동완성과 기준 데이터 검증 [P0] — `COMP-*`

- 운영자 마스터 `composers`/`composer_aliases`에서 **PRD 부록 B 30명**을 `seed_candidate` 상태로 제안한다. 이미 있는 레코드와 ID/이름/출처를 매칭하여 중복 등록을 피한다. 실제 생성·공개 전에는 출처·생몰년·국적/활동국가·시대·약칭을 검증하고 `verification_status`를 `verified`로 승격한다.
- `composers` 후보 컬럼: `short_display_name`, `full_name`, `birth_year`, `death_year nullable`, `birth_year_is_approximate`, `country_code nullable`, `birthplace_country_code nullable`, `primary_activity_country_code nullable`, `era_code nullable`, `source_id`, `verification_status`.
- 역사적인 국가 개념이 달라지는 인물은 `country`를 하나의 단정 문자열로 넣지 않고 출생지·활동 지역·현대 표기/설명을 분리한다.
- `composer_aliases`: `composer_id`, `language_code`, `alias`, `normalized_alias`, `kind enum(full,short,translated,transliterated,common)`, `verification_status`; `UNIQUE(composer_id, normalized_alias, kind)` 후보. **서로 다른 작곡가가 같은 약칭을 가질 수도 있으므로 normalized_alias 전역 유니크 금지**.
- `composer_search_key`/별칭 정규화와 인덱스: 악센트 제거 및 Unicode normalization, 공백/구두점 표준화, 필요 시 prefix index, text search, `pg_trgm`을 단계적으로 평가. **`B` 한 글자 입력부터 후보**를 반환하되 인기 기준/정확성/가까운 표기/본인 최근 사용값을 고려하고 반환 상한을 둔다.
- `works`/`work_titles`의 원어/번역/작품번호 검색을 같은 자동완성 컨텍스트에 연결한다. **후보가 없더라도 개인 미분류 악보 저장은 허용한다**.
- 호버/터치/키보드 상세: `J. S. Bach (1685–1750, Germany)` → `Johann Sebastian Bach, 1685–1750, Germany, Baroque`는 **검증된 데이터가 있을 때의 포맷 예시**. 정보 공란은 임의 대체하지 않는다.

## 🟢 24. 사용자별 음악 이름·표시 순서·전례 역할 검색 [P0] — `PERS-*`

- 원본 전례 항목 `rite_items`/`liturgical_roles`는 관리자 읽기 전용. 사용자의 한글·라틴어·영어/직접 정한 이름은 `user_mass_layout_items`, `mass_music_slots.label_snapshot`, `template_music_slots.label_snapshot` 등에 저장한다.
- `saved_views`는 콘텐츠 표시 필드와 순서를 저장하고, `user_ui_preferences`는 배경색·폰트·대표 이미지, `user_format_preferences`는 날짜/시간, `user_page_turn_settings`는 조작 설정으로 **책임을 분리**한다.
- 메뉴 정렬을 사용자에게 노출할 항목과 순서를 저장하는 `user_repertoire_sort_preferences`(27.2의 신규 제안)과 역할 그룹 정렬이 겹치지 않게 실제 스키마를 확인해 연결한다.
- 라벨 변형이 `liturgical_role_id` 기반 **교집합 검색·연주 횟수**에 영향을 주지 않아야 한다.

## 🟢 25. 오프라인 악보 준비와 캐시 식별 [P0] — `PERF-*`, `TURN-*`

- 원본 `score_revision_id`와 `score_performance_version_id`를 함께 고려하여 **기기에 내려받을 페이지 집합을 결정**한다. 편집본은 선택한 원본 리비전의 페이지 참조에 맞는 파일을 저장한다.
- 웹앱의 `IndexedDB`/Cache API를 사용하되 **브라우저별 저장 용량·삭제 정책을 검증**한다. 캐시는 사용자 본인의 파일과 키로 구별하고 로그아웃/계정 전환 시 타인의 비공개 악보를 노출하지 않는다.
- `offline_manifest` 구조(기기에 저장되는 목록의 버전/해시/파일 식별 정보)는 우선 **클라이언트 로컬 데이터**로 관리한다. 필요하면 서버에 사용자별 동기화 메타데이터를 저장하되, 실제 오프라인 바이너리를 PostgreSQL 테이블에 두지 않는다.
- 다운로드 '완료'는 참조 악보와 편집본 페이지가 실제로 열리는지 검증한 뒤 표시한다. 다운로드 중단/저장소 삭제/버전 변경 시 상태를 다시 확인한다.

## 🟢 26. PRD 0.6 추적표 및 추가 검증 사례 (추가 설계 포함)

| PRD ID | DB 개체/근거 | 위험 및 검증 |
|---|---|---|
| `RITE-*` | `rite_templates`, `rite_items`, `user_mass_layouts`, `mass_music_slots` | 33개 순서/17개 슬롯/다국어·권한·스냅샷 |
| `COMP-*` | `composers`, `composer_aliases`, `works`, `work_titles` | 30명 검증 상태, 1글자 자동완성, 중복/동명이인 |
| `QUICK-*` | `owned_scores`, `score_assets`, `score_upload_jobs`, `mass_music_entries` | 어떤 화면의 업로드든 개인 라이브러리 등록+슬롯 자동 연결 |
| `ENTRY-*` | `owned_scores.work_id NULL`, 자동완성 인덱스 | 빈 작곡가/곡명도 저장, 후속 상세 편집 |
| `SV-*` | `score_revisions` ≠ `score_performance_versions`, `score_performance_version_pages` | 6쪽→3쪽 편집본, 원본 보존, 다른 미사 연결 안전 |
| `TURN-*` | `user_page_turn_settings`, offline manifest client | 실기기 HID 발 페달·오프라인·버튼 프리셋 |
| `TIME-*` | `created_at`, `last_edited_at`, `updated_at` | 원본 생성 일시 불변, 마지막 편집 시각만 UI 표시 |
| `TYPE-*` | `font_family_key='pretendard'`, `user_format_preferences` | 기본 Pretendard/한글 날짜 정확한 표현 |
| `PERS-*` | `user_mass_layout_items`, `saved_views`, `user_ui_preferences` | 기준 데이터 보호, 명칭 자유 편집·검색 불변 |
| `IMPR-*` | 별도 장래 워크스페이스 설계 | 사용자 승인 전 AI 작업 생성·학습·전송 금지 |

**추가 DB 테스트 (승인 후 별도 테스트 스키마에서):**

1. 음악 가능 슬롯 17개만 미사 구성 화면에서 선택 가능하며, 사용자 B가 명칭을 변경해도 사용자 A의 기준 데이터는 그대로다.
2. 미사 슬롯에 직접 PDF 업로드 → 업로드 완료 후 `owned_scores` 1개, `score_assets` 1개 이상, 슬롯 링크 1개, 다른 미사에도 동일 `owned_score_id` 재연결. 중복 저장되지 않는다.
3. 새 악보 `work_id=NULL`이 저장되고 검색/레퍼토리에서 미분류로 나타난다. 사용자 A는 사용자 B의 파일 ID를 연결할 수 없다.
4. 원본 6쪽 → 연주용 편집본 1~3쪽 생성 → 과거 미사 1개/미래 미사 1개 연결. 원본 리비전 교체 후에도 과거 편집본의 페이지가 그대로 열린다.
5. 최초 저장 시각을 일반 클라이언트에서 UPDATE 시도하면 거절된다. 사용자가 제목/페이지를 실제 수정하면 `last_edited_at`만 최신으로 바뀌고 최초 값은 보존된다.
6. 기본 날짜 표현 `2026년 10월 21일(수요일)`이 일치한다. `user_format_preferences` 변경 후 다른 사용자의 날짜 형식은 유지된다.
7. 사용자별 페달/솔로/도우미 프리셋을 저장하고 다시 로그인한 뒤 불러온다. 실제 iPad/Android의 HID 페달 입력 실기기 테스트는 DB만으로 통과 처리하지 않는다.
8. 개인 음악 슬롯 이름을 라틴어/영어로 바꾼 뒤에도 역할 기반 `성탄 AND 영성체 후 묵상 AND d minor AND 확인 3회 이하` 검색은 정확하다.

> **SQL 실행 금지:** 이 문서는 구조/제약/테스트 설계만 기술한다. 마이그레이션은 읽기 전용 코드·DB 점검, 백업·롤백 계획, 사용자 명시적 승인 후 별도 파일에서 작성한다.


## 🟢 27. 레퍼토리 수동 순서·정렬 메뉴·다중 그룹 [P0] — PRD `SORT-*`, `UI-*`

> PRD v0.4 이후 확정된 메뉴 동작을 실제 데이터 구조로 구체화한다. **정렬과 필터, 그룹화는 서로 다른 개념**이며 변경 가능한 문자열 이름을 표준 분류 키로 쓰지 않는다.

### 27.1 `user_repertoire_items` — 원본 작품/미분류 악보 공존

`id uuid PK`, `user_id uuid`, `work_id uuid NULL`, `owned_score_id uuid NULL`, `manual_order numeric`, `added_at timestamptz`, `hidden_at NULL`, `created_at`.

- **정확히 하나 이상의 연결 대상**이 필요. 공통 작품으로 연결한 항목과 `work_id IS NULL`인 미분류 악보를 모두 보여줄 수 있어야 한다.
- 동일 작품에 악보가 여러 개 있으면 작품 중심 보기를 원칙으로 하되, 개인이 의도적으로 원본/다른 판본을 별도 항목으로 관리하는 경우 정책을 정한다. **한 작품의 여러 개인 악보를 하나의 작품 검색 결과에서 보되 실제 파일을 각각 찾을 수 있어야 한다.**
- 순위 필드 `manual_order`는 자리를 바꾸기 쉬운 fractional rank 같은 방식도 검토하되 정렬 충돌/재정렬 정책이 필요하다.

### 27.2 `user_repertoire_sort_preferences` — 표시할 정렬 항목과 순서

`user_id uuid PK`, `available_sort_keys jsonb`, `menu_order_keys jsonb`, `default_sort_key text`, `direction enum(asc,desc)`, `season_group_order jsonb`, `era_group_order jsonb`, `role_group_order jsonb`, `updated_at`.

- 허용된 정렬 키: `saved_order`, `title_alpha`, `title_korean`, `composer`, `era_group`, `season_group`, `liturgical_role_group`, `performance_count`, `last_performed`.
- 기본 전례 시기 순서: `대림→성탄→사순→부활→연중`. 기본 시대 순서: `르네상스→바로크→고전→낭만→20세기→현대`.
- 작품은 여러 시기/역할에 속할 수 있으므로 **그룹 표시용 행 중복과 원본 작품·확인 연주 건수의 중복을 구별**한다. 그룹 화면이 실제 사용 기록 기반인지 관리자 제공 참고 태그 기반인지 표시한다.
- `jsonb`는 지정된 정렬 키 배열만 받도록 검증하며 스키마 버전 필드를 붙인다. 사용자 임의 SQL/ORDER BY를 만들지 않는다.

### 27.3 기본 목록의 표시 계약

- **곡명(작품번호 포함) + 작곡가 약칭은 필수.** 검증된 경우 생몰년/국적은 보조 행에서 볼 수 있어야 한다. 상세 메타데이터는 사용자 선택 시 표시.
- 좁은 내용 열·낮은 행 높이·정렬된 텍스트 기준선·Pretendard. **저장 순서는 별도 수동 순서**, `created_at`/`added_at`과 혼동하지 않는다.
- `작품`, `개인 악보`, `연주용 편집본`의 레퍼토리 표시와 `Score Search`의 실제 바이너리 검색은 연결되지만 동일한 화면이 아니다.

## 🟢 28. 역사적 오르간·Specification·관계 근거 [P1 구조 / P2 심화] — PRD `ORGN-*`

### 28.1 기본 테이블 후보

| 테이블 | 핵심 컬럼 | 의미 |
|---|---|---|
| `historic_organs` | `id`, `name`, `church_or_venue_name`, `location_id nullable`, `builder`, `built_year nullable`, `status`, `verification_status` | 역사적 오르간 자체 |
| `organ_specification_versions` | `id`, `organ_id`, `effective_from/to nullable`, `manuals`, `pedal_compass`, `specification_text`, `stoplist_structured jsonb`, `source_id`, `verification_status` | 증개축/복원 전후 사양 구분 |
| `work_organ_associations` | `work_id`, `organ_id`, `relationship_type`, `evidence_source_id`, `confidence_level` | 의도 악기/역사적 관련/연주 악기 추정 등을 명확히 구분 |
| `organ_media_assets` | `id`, `organ_id`, `asset_type`, `storage_key nullable`, `external_url nullable`, `license_id nullable`, `attribution`, `verified` | 사진·음원·영상 자료의 권한/출처 |
| `user_organ_notes` | `id`, `user_id`, `organ_id`, `note`, `created_at`, `last_edited_at` | 사용자 개인 연구 메모 |

- `BWV 552 = 특정 교회/특정 오르간을 위해 작곡`과 같은 **인과관계는 검증 출처 없이 저장 금지**. 작곡가 활동지, 작품 의도 악기, 특정 기관의 오르간, 후대 실제 연주 기종은 각각 다르게 모델링한다.
- 역사적 오르간의 정면 사진·Stoplist·녹음이 있더라도 해당 자료의 사진가/연주자/권리자·파일 권한을 확인한다.
- 원본은 사적/라이선스 범위에 맞는 스토리지에 보관, 표시용 메타데이터는 적정 범위에서 공개.

## 🟢 29. 미사 음원·외부 영상·A–B 반복 [P1] — PRD `MEDIA-*`

### 29.1 `performance_media`, `media_file_assets`, `media_loop_markers`

- `performance_media(id, user_id, mass_event_id FK, mass_music_entry_id FK NULL, media_type enum(audio,external_video), title, rights_status, created_at, last_edited_at)`.
- `media_file_assets(id, user_id, performance_media_id FK, storage_provider, bucket_name, object_key, mime_type, bytes, duration_ms, codec, sample_rate_hz, channels, preservation_role enum(original,streaming), processing_status)` — **음원 업로드/원본 품질 보존·호환 파일 분리**.
- `media_external_links(id, user_id, performance_media_id FK, url, platform, verified_at)` — YouTube 등 외부 링크. 등록 경로/표시 방식 안전성 확인.
- `media_loop_markers(id, user_id, performance_media_id FK, start_ms, end_ms, created_at)` — 향후 A–B 구간 저장 시. `0 ≤ start_ms < end_ms ≤ duration_ms` 검사.

### 29.2 재생·권한·음질

- 음악 파일은 **서비스 측 재압축을 원칙적으로 강제하지 않는다**. 지원되는 원본 WAV/FLAC 등은 선택에 따라 보존하고 별도의 브라우저 호환 음원(AAC/MP3 등)은 필요 시 생성한다. **음질은 원본 녹음/마스터링 품질과 인코딩에 달려 있다.**
- A–B 구간 반복은 모바일 브라우저에서 실제 시간 오차·갭을 테스트한다. 정확도가 중요한 경우 Web Audio를 포함한 별도 처리 전략 고려.
- **사용자별 RLS + 비공개 버킷 + 짧은 수명 접근 URL/Range 요청 처리**; 성가대/영상 공개는 저작권과 참여자 동의 정책 확정 전 별도 범위.
- 한 곡/미사 전체 기록을 연결할 때 `mass_music_entry_id`와 `mass_event_id`가 일치하도록 서버/DB 검증한다.

## 🟢 30. 핵심 관계 재확인 · 마이그레이션 순서 [검토 전용]

```text
                    [Administrator Master]
rite_templates -> rite_items -> liturgical_roles
        │              │
        │              ├-> user_mass_layout_items -> user_mass_layouts
        └-> mass_events -> mass_music_slots -> mass_music_entries -> performance_confirmations
                                  │                   │
                                  │                   ├----> works -> composers / aliases
                                  │                   ├----> owned_scores -> score_assets
                                  │                   │           ├-> score_revisions -> score_revision_pages
                                  │                   │           └-> score_performance_versions -> score_performance_version_pages
                                  │                   └----> user-specific performance statistics

My Repertoire (work OR unclassified owned score) -> Search / Score Search
Global score Quick Add (camera / PDF) -> owned_scores -> any mass/template/practice slot
User UI prefs: saved_views | sort_preferences | format_preferences | page_turn_settings
```

**구현 검토 순서:**

1. Supabase/Auth/버킷·프로젝트 실제 스키마를 **읽기 전용 확인**. 기존 회원UID/리디렉션 보호 및 DB·파일 별도 백업 전략 검토.
2. 작성 전 명명 충돌·기존 테이블 의존성·RLS·복합 소유권 FK·비파괴 버전 정책을 보고. 사용자 명시적 승인 대기.
3. 기준 마스터 + 개인 미사/슬롯/작품/악보/업로드 상태를 **작은 마이그레이션**으로 구축. 실기기 PWA/HID는 별도 프론트엔드 테스트.
4. 검색 `AND` + 확인 연주 횟수/0회 집계 검증; 편집본·오프라인·기간/역할 집계, 초소형 UI/폰트·날짜 정렬 검증.
5. 작업마다 회귀 테스트, 롤백·백업 확인. 실제로 합격한 기능만 `implemented`로 표시.

**미결 설계:** 사용자 보유 작품의 중복 허용 정책, 미분류 악보와 작품 레퍼토리의 합류 규칙, 장기적으로 지워진 작품/사용자 악보의 참조 보존, `score_performance_versions`의 기존 미사 적용 정책, 0회 검색의 모집단, 음원 저장비용, 전례와 작곡가 기준 데이터 사실검증.

> **이 문서는 SQL 마이그레이션 파일이 아니다. 운영 환경에서 테이블이나 파일을 자동 생성/삭제/복구하지 마라.**

## ✅ 31. 1단계 구현 현황 (Implemented, 2026-10-21)

실제 SQL은 `supabase/migrations/20261021100000_phase1_reference.sql` ~ `20261021100300_phase1_seed.sql` 4개 파일이다. 사용자 승인 후 하나씩 적용했고, 기존 `auth` 스키마·회원·예전 마이그레이션 기록은 바꾸지 않았다. 모두 **추가만** 했다.

### 31.1 적용된 테이블

| 구분 | 테이블 | 상태 |
|---|---|---|
| 운영자 기준 | `liturgical_observances` | 구현됨. 2026년 9~12월 주일·대축일 등 20일(23줄), 공식 매일미사 페이지 제목 줄의 명칭·색만 저장, `verification_status='source_checked'` |
| 운영자 기준 | `liturgical_roles` | 구현됨. 음악 항목 18개, `slot_no` 0~17 고정 순서, `rite_sequence_no`는 비어 있음 |
| 운영자 기준 | `works` | 빈 표. 화면 없음(2단계 조성 검색용) |
| 개인 | `user_mass_layouts`, `user_mass_layout_items` | 구현됨(미사틀). 미사에는 복사만 하며, 미사틀을 지우면 `mass_events.layout_id`만 비워짐 |
| 개인 | `mass_events` | 구현됨. 같은 날 여러 미사 허용, 전례 명칭·색·시기를 복사 보관, `liturgy_source` = `official`/`user`/`unknown` |
| 개인 | `mass_music_slots` | 구현됨. `UNIQUE(mass_event_id, role_id)`, 미사별 표시 이름 |
| 개인 | `owned_scores` | 구현됨. `title`·`composer_name` 선택, `provisional_title` 필수, `status` = `uploading`/`ready`, `created_at` 변경 불가(트리거), `last_edited_at`은 제목·작곡가 변경과 페이지 추가·삭제·순서 변경 시에만 갱신(트리거, §31.5) |
| 개인 | `score_files` | 구현됨(§7.3 `score_assets`의 1단계 축소판). 경로 `{user_id}/{score_id}/{file_id}.{ext}`를 CHECK로 강제, UPDATE는 `page_no`만 허용(§31.5) |
| 개인 | `mass_music_entries` | 구현됨. **미사 항목(slot) 1개 + 악보 1개**를 잇는 연결 기록 |
| 개인 | `performance_confirmations` | 빈 표. 화면 없음. 연결해도 행이 생기지 않음(연주 횟수 0 유지) |

### 31.2 보장 장치

- **같은 주인끼리만 연결:** 개인 표 사이의 모든 외래키는 `(id, user_id)` 복합 외래키다. 다른 회원의 악보를 내 미사에 연결하면 DB가 거부한다.
- **본인 행만:** 개인 표 8개 모두 RLS `user_id = (select auth.uid())`. 기준 표는 로그인 회원 읽기 전용. 익명(anon) 권한은 모두 회수.
- **비파괴:** 연결된 악보 삭제 거부(`23503`), 연주 확인이 있는 연결 삭제 거부, 연결 해제는 연결 행만 삭제. 미사를 지우면 그 미사의 항목·연결만 지워지고 악보는 남는다.
- **Storage:** 비공개 버킷 `scores`(20MB, PDF·JPG·PNG). 정책 3개 — 본인 폴더 읽기, 본인 폴더 올리기, 본인 폴더 중 **어떤 `score_files` 행도 가리키지 않는 파일만** 삭제. UPDATE 정책이 없어 덮어쓰기 불가.

### 31.3 이 설계서(§5~§9, §18~§21)와 다른 점

- 음악 항목은 PRD `RITE-002`의 17개가 아니라 사용자 요청의 **18개**다(`주님께 나라와` 추가, `파견` 제외, `후주` 분리). 순서 변경(`RITE-004`)은 1단계에서 허용하지 않는다.
- `rite_templates`, `rite_items`, `score_revisions`, `score_assets`, `score_upload_jobs`, `composers`는 아직 만들지 않았다. 1단계 파일 메타데이터는 `score_files` 하나로 처리한다.
- `mass_music_entries`는 `mass_event_id`를 직접 갖지 않고 `mass_music_slot_id`를 통해 미사·역할을 읽는다. 2단계 교집합 검색은 "연결 행 1개 → 그 행의 slot(역할) → 그 slot의 미사(시기·상태·날짜)"를 한 줄로 묶어 조건을 건다.
- 전례 시기(`season_code`)는 공식 제목에 시기 단어(연중·대림·성탄)가 있을 때만 채웠다. 대축일 등 6줄은 `NULL`(미확인)이다.

### 31.4 아직 검증이 남은 항목

- 테스트 계정 2개로 `node --test tests/phase1-api.test.mjs`(시나리오·권한 자동 시험) 실행.
- 성능 점검 INFO: `user_id` 단독 외래키 7개에 인덱스 없음(복합 인덱스로 대부분 커버, 회원 삭제 시에만 영향). 필요하면 승인 후 인덱스 추가.

### 31.5 보완: 사진 Score 페이지 순서 변경 (2026-10-21, `20261021120000_score_page_order.sql`)

사용자 승인 후 적용했다. 기존 표·행은 바꾸지 않고 권한·정책·트리거만 **추가**했다.

- **권한:** `grant update (page_no) on score_files to authenticated` — 열 단위 권한이라 경로·크기·형식 등 다른 열은 바꿀 수 없다.
- **정책:** `score_files_update_own` — 본인 행만 UPDATE(`user_id = (select auth.uid())`).
- **트리거:** `score_files_touch_score`(AFTER INSERT/DELETE/UPDATE OF `page_no`) → 그 악보가 `status='ready'`일 때만 `owned_scores.last_edited_at = now()`. 처음 올리는 중(`uploading`)에 쪽을 넣을 때는 수정 시각이 바뀌지 않는다. 회원이 `last_edited_at`을 직접 바꾸는 것은 여전히 막힌다(`pg_trigger_depth() > 1`일 때만 허용).
- **앱의 저장 순서:** 새 쪽 올리기 → 쪽 번호 고치기(바뀐 행만) → 뺀 쪽 지우기(행 먼저, 파일 나중). 앞 단계가 실패하면 뒤 단계는 실행하지 않으므로 기존 쪽이 먼저 사라지는 일은 없다. 새 쪽 올리기가 중간에 실패하면 그때 넣은 행과 파일만 되돌린다.
- **알려진 한계:** 행을 지운 뒤 Storage 파일 삭제가 실패하면 파일만 남는다(화면에는 보이지 않음, 용량만 차지). 나중에 정리 작업으로 처리한다.
- **범위:** 사진 Score만. PDF 쪽 편집, 저장 후 회전·자르기는 아직 없다(회전·자르기는 "새 파일로 바꾸고 원본 삭제" 방식으로 하기로 했고, 만들기 전에 다시 확인한다).
- **검증(실제 DB, 되돌리기 전용 블록):** 올리는 중 넣기·상태 변경은 수정 시각 유지, 직접 변경 차단, `page_no` 변경·쪽 추가·삭제 시 갱신, 경로·크기 변경 거부, 악보 삭제 시 연쇄 삭제 정상, 남은 시험 행 0개.

### 31.6 정기 Mass (2026-10-21, `20261021140000_mass_series.sql`)

사용자 승인 후 적용했다. 기존 표·행은 지우거나 바꾸지 않고 표 2개와 `mass_events` 칸 2개만 **추가**했다.

- 추가만 한다. `mass_series`(이름·시간·장소·Layout·요일·매주/격주·시작·종료), `mass_series_skips`(지운 날짜를 다시 만들지 않음), `mass_events.series_id`·`series_locked`.
- 기존 Mass 행은 `series_id`가 비어 한 번짜리로 남는다. Auth·Score·연결은 그대로다.
- 달력을 열 때 없는 날짜만 만들고, 그 날짜의 전례 정보를 붙인다. 지난주 악보·연주 확인은 복사하지 않는다.
- `series_locked`인 날짜는 반복 설정을 고쳐도 바뀌지 않는다. 과거 날짜도 바꾸지 않는다.
- `liturgical_roles`에서 `code='entrance'`이고 이름이 `입당`인 행만 `입당성가`로 바꾼다. 사용자가 적어 둔 표시 이름은 덮지 않는다.
- **검증(실제 DB, 되돌리기 전용 블록):** 본인 반복 설정 저장·조회 정상, 같은 반복의 같은 날짜 중복 저장 거부, 다른 계정은 조회·수정·건너뛸 날짜 추가 모두 차단, 반복 설정을 지워도 날짜별 Mass는 남고 연결만 비워짐, 남은 시험 행 0개.

### 31.7 영어 전례 명칭 (2026-10-22, `20261022120000_observance_english_names.sql`)

사용자 요청으로 적용했다. `liturgical_observances` 23줄의 비어 있던 `name_en`만 채웠고, `name_ko`·색·시기·`mass_events` 기록은 바꾸지 않았다.

- 출처: 굿뉴스 매일미사 목록의 영어 제목. 9/20 한국 순교자 대축일(굿뉴스가 미국 전례력의 연중 제25주일을 표시)과 10/18 민족들의 복음화를 위한 미사, 12/25 세 미사의 구분은 로마 미사 경본 영어판(USCCB) 표기를 썼다. 자세한 내용은 마이그레이션 주석.
- 화면: 전례일 이름은 `name_en`이 있으면 영어, 없으면 `name_ko`. 공식 전례로 저장된 Missa는 `observance_id`로 연결된 전례일 이름을 읽어 보여주고, `celebration_name`(저장 당시 한국어 복사본)은 기록으로 남긴다. 사용자가 직접 입력한 이름은 그대로 표시한다.
- 새 날짜를 추가할 때는 `name_ko`와 함께 같은 출처 순서로 `name_en`을 채운다. 확인되지 않으면 비워 두고 한국어가 표시된다.
