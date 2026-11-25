export interface ApiEnvelope<T> {
  code: number;
  message?: string;
  error?: unknown;
  data: T;
}

export interface RawCategoryNode {
  id: string;
  name: string | null;
  en_name?: string | null;
  i18n_name?: string | null;
  depth?: number | null;
  parent?: RawCategoryNode | null;
  children?: RawCategoryNode[] | null;
}

export interface RawCity {
  code: string;
  name: string | null;
  en_name?: string | null;
  i18n_name?: string | null;
  py_name?: string | null;
}

export interface RawSubject {
  id: string;
  name?: {
    zh_cn?: string | null;
    en_us?: string | null;
    i18n?: string | null;
  } | string | null;
  active_status?: number | null;
  subject_group_info?: {
    id?: string;
    name?: string | null;
    en_name?: string | null;
    i18n_name?: string | null;
  } | null;
}

export interface RawFiltersData {
  job_type_list?: RawCategoryNode[] | null;
  city_list?: RawCity[] | null;
  job_subject_list?: RawSubject[] | null;
}

export interface RawRecruitType {
  id: string;
  name?: string | null;
  en_name?: string | null;
  i18n_name?: string | null;
  parent?: RawRecruitType | null;
}

export interface RawJobPostInfo {
  address?: string | null;
  education?: string | null;
  experience?: string | null;
  min_salary?: number | null;
  max_salary?: number | null;
  currency?: string | null;
  head_count?: number | null;
  expiry_time?: number | null;
  job_type?: string | null;
}

export interface RawTag {
  id?: string;
  name?: string | null;
  en_name?: string | null;
}

export interface RawJobPost {
  id: string;
  title: string;
  sub_title?: string | null;
  code?: string | null;
  description?: string | null;
  requirement?: string | null;
  publish_time?: number | null;
  job_hot_flag?: number | null;
  job_category?: RawCategoryNode | null;
  city_info?: RawCity | null;
  city_list?: RawCity[] | null;
  recruit_type?: RawRecruitType | null;
  job_subject?: RawSubject | null;
  job_post_info?: RawJobPostInfo | null;
  tag_list?: RawTag[] | null;
}

export interface RawSearchData {
  count: number;
  job_post_list?: RawJobPost[] | null;
}

export interface RawJobDetailData {
  job_post_detail?: RawJobPost | null;
}

export interface SearchJobParams {
  keyword?: string;
  categoryIds?: string[];
  cityCodes?: string[];
  subjectIds?: string[];
  recruitmentIds?: string[];
  page: number;
  limit: number;
}
