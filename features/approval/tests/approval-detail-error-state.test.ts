import { ApiProblem } from "@fmerp/shared/lib/api";
import { LoadingState } from "@fmerp/shared/ui/loading-state";
import { QueryErrorState } from "@fmerp/shared/ui/query-error-state";
import Link from "next/link";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalDetailPage } from "../src/ui/components/approval-detail";
import AbsencePage from "../src/ui/pages/absence";
import FormBuilderPage from "../src/ui/pages/admin-form-edit";
import AdminFormsPage from "../src/ui/pages/admin-forms";
import DraftEditorPage from "../src/ui/pages/draft";
import MyDocumentsPage from "../src/ui/pages/mine";
import NewApprovalPage from "../src/ui/pages/new-approval";
import PendingPage from "../src/ui/pages/pending";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    approval: vi.fn(),
    approvalBody: vi.fn(),
    approvalPolicy: vi.fn(),
    attachments: vi.fn(),
    comments: vi.fn(),
    pending: vi.fn(),
    members: vi.fn(),
    departments: vi.fn(),
    businesses: vi.fn(),
    capabilities: vi.fn(),
    me: vi.fn(),
    account: vi.fn(),
    forms: vi.fn(),
    mine: vi.fn(),
    formDetail: vi.fn(),
    query: vi.fn(),
    params: { id: "doc-1" },
    router: { replace: vi.fn(), push: vi.fn() },
  },
}));

// 페이지의 오류 분기는 실제로 실행하되 렌더러 없이 훅의 초기값만 제공한다.
// 자식 컴포넌트는 실행하거나 대체하지 않고 반환 요소의 실제 props/children을 검사한다.
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useState: <T>(initial: T | (() => T)) => [
    typeof initial === "function" ? (initial as () => T)() : initial,
    vi.fn(),
  ],
  useCallback: <T>(callback: T) => callback,
  useRef: <T>(initial: T) => ({ current: initial }),
  useMemo: <T>(factory: () => T) => factory(),
  useEffect: vi.fn(),
}));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQuery: mocks.query,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  useParams: () => mocks.params,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("react-hook-form", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-hook-form")>()),
  useForm: () => ({}),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("../src/ui/queries", () => ({
  useApproval: mocks.approval,
  useApprovalBody: mocks.approvalBody,
  useApprovalPolicy: mocks.approvalPolicy,
  useAttachments: mocks.attachments,
  useComments: mocks.comments,
  useFormDetail: mocks.formDetail,
}));
vi.mock("@fmerp/shared/lib/queries", () => ({
  useBusinesses: mocks.businesses,
  useCapabilities: mocks.capabilities,
  useDepartments: mocks.departments,
  useMe: mocks.me,
  useMembers: mocks.members,
  usePending: mocks.pending,
  useCurrentAccount: mocks.account,
  useForms: mocks.forms,
  useMine: mocks.mine,
}));

beforeEach(() => {
  mocks.params.id = "doc-1";
  for (const query of [
    mocks.approval,
    mocks.approvalBody,
    mocks.approvalPolicy,
    mocks.attachments,
    mocks.comments,
    mocks.pending,
    mocks.members,
    mocks.departments,
    mocks.businesses,
    mocks.capabilities,
    mocks.me,
    mocks.account,
    mocks.forms,
    mocks.mine,
    mocks.formDetail,
    mocks.query,
  ]) {
    query.mockReturnValue({ data: undefined, isError: false, refetch: vi.fn() });
  }
});

function renderApproval(error: unknown, refetch = vi.fn()) {
  mocks.approval.mockReturnValue({ data: undefined, error, refetch });
  mocks.approvalBody.mockReturnValue({ data: undefined });
  mocks.approvalPolicy.mockReturnValue({ data: undefined });
  mocks.attachments.mockReturnValue({ data: undefined });
  mocks.comments.mockReturnValue({ data: undefined });
  mocks.pending.mockReturnValue({ data: undefined });
  mocks.members.mockReturnValue({ data: undefined });
  mocks.departments.mockReturnValue({ data: undefined });
  mocks.businesses.mockReturnValue({ data: undefined });
  mocks.capabilities.mockReturnValue({ data: undefined });
  mocks.me.mockReturnValue({ data: undefined });

  return ApprovalDetailPage({
    id: "doc-1",
    printButton: null,
    timeline: null,
    completionFiles: null,
  });
}

type TreeProps = { children?: ReactNode; role?: string; href?: string };

function elements(node: ReactNode): ReactElement<TreeProps>[] {
  return Children.toArray(node).flatMap((child) =>
    isValidElement<TreeProps>(child) ? [child, ...elements(child.props.children)] : [],
  );
}

function text(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) => (isValidElement<TreeProps>(child) ? text(child.props.children) : String(child)))
    .join("");
}

afterEach(() => {
  expect(mocks.router.replace).not.toHaveBeenCalled();
  expect(mocks.router.push).not.toHaveBeenCalled();
  vi.clearAllMocks();
});

describe("ApprovalDetailPage query error component tree", () => {
  afterEach(() => {
    expect(mocks.approval).toHaveBeenCalledWith("doc-1");
  });
  it("403은 실제 alert에 서버 errorMessage와 문서함 Link를 제공한다", () => {
    const tree = renderApproval(new ApiProblem(403, "forbidden", "문서 열람 권한이 없습니다"));
    const nodes = elements(tree);
    const alerts = nodes.filter((node) => node.props.role === "alert");
    const links = nodes.filter((node) => node.type === Link);

    expect(alerts).toHaveLength(1);
    expect(text(alerts[0])).toBe("문서 열람 권한이 없습니다");
    expect(links).toHaveLength(1);
    expect(links[0]?.props.href).toBe("/mailbox");
    expect(text(links[0])).toBe("문서함으로 이동");
    expect(nodes.some((node) => node.type === QueryErrorState)).toBe(false);
  });

  it("404는 실제 alert에 개인정보 보호 문구만 표시하고 비공개 상세를 노출하지 않는다", () => {
    const tree = renderApproval(new ApiProblem(404, "not_found", "private document detail"));
    const nodes = elements(tree);
    const alerts = nodes.filter((node) => node.props.role === "alert");
    const links = nodes.filter((node) => node.type === Link);

    expect(alerts).toHaveLength(1);
    expect(text(alerts[0])).toBe(
      "문서가 없거나 열람 권한이 없습니다. 문서함이나 검색에서 다시 찾아 보세요.",
    );
    expect(text(tree)).not.toContain("private document detail");
    expect(links).toHaveLength(1);
    expect(links[0]?.props.href).toBe("/mailbox");
    expect(text(links[0])).toBe("문서함으로 이동");
    expect(nodes.some((node) => node.type === QueryErrorState)).toBe(false);
  });

  it("500은 실제 QueryErrorState의 onRetry가 원래 refetch를 한 번 호출한다", () => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    const tree = renderApproval(new ApiProblem(500, "internal", "서버 오류"), refetch);

    expect(tree.type).toBe(QueryErrorState);
    if (!isValidElement<{ onRetry: () => void; message?: string }>(tree)) {
      throw new Error("QueryErrorState 요소가 필요합니다");
    }
    expect(tree.props.message).toBeUndefined();
    expect(tree.props.onRetry).toBeTypeOf("function");
    expect(refetch).not.toHaveBeenCalled();
    tree.props.onRetry();
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(refetch).toHaveBeenCalledWith();
  });
});

// 결재 기능의 실제 진입점을 호출한다. 오류 UI의 콜백을 실행해 쿼리 연결도 검증한다.
const screenCases = [
  { name: "admin-form-edit", page: FormBuilderPage, query: mocks.formDetail, args: ["doc-1"] },
  { name: "admin-forms", page: AdminFormsPage, query: mocks.forms, args: [true] },
  { name: "absence", page: AbsencePage, query: mocks.members, args: [] },
  { name: "mine", page: MyDocumentsPage, query: mocks.mine, args: [] },
  { name: "new-approval", page: NewApprovalPage, query: mocks.forms, args: [] },
  { name: "pending", page: PendingPage, query: mocks.pending, args: [] },
];

function retry(tree: ReactNode) {
  expect(isValidElement(tree) && tree.type).toBe(QueryErrorState);
  if (!isValidElement<{ onRetry: () => void }>(tree)) {
    throw new Error("실제 QueryErrorState 요소가 필요합니다");
  }
  expect(tree.props.onRetry).toBeTypeOf("function");
  tree.props.onRetry();
}

describe("원본 열 화면의 대기·오류·refetch 연결", () => {
  it.each(screenCases)("$name 대기는 실제 LoadingState를 반환한다", ({ page, query, args }) => {
    const tree = page();
    expect(tree.type).toBe(LoadingState);
    expect(query).toHaveBeenCalledWith(...args);
  });

  it.each(screenCases)("$name 오류는 해당 쿼리만 재시도한다", ({ page, query, args }) => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    query.mockReturnValue({ data: undefined, isError: true, refetch });
    const tree = page();
    expect(query).toHaveBeenCalledWith(...args);
    expect(refetch).not.toHaveBeenCalled();
    retry(tree);
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(refetch).toHaveBeenCalledWith();
    for (const other of [
      mocks.me,
      mocks.account,
      mocks.formDetail,
      mocks.forms,
      mocks.members,
      mocks.mine,
      mocks.pending,
    ]) {
      if (other !== query) expect(other.getMockImplementation()?.().refetch).not.toHaveBeenCalled();
    }
  });

  it("approval-detail 대기는 실제 LoadingState를 반환한다", () => {
    expect(renderApproval(undefined).type).toBe(LoadingState);
  });

  it("draft 대기는 실제 LoadingState를 반환한다", () => {
    expect(DraftEditorPage().type).toBe(LoadingState);
    expect(mocks.approval).toHaveBeenCalledWith("doc-1");
    expect(mocks.query).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["approval-form", "doc-1"] }),
    );
  });

  it.each([
    { viewError: true, formError: false },
    { viewError: false, formError: true },
    { viewError: true, formError: true },
  ])("draft 오류별 재시도 $viewError/$formError", ({ viewError, formError }) => {
    const refetchView = vi.fn().mockResolvedValue(undefined);
    const refetchForm = vi.fn().mockResolvedValue(undefined);
    mocks.approval.mockReturnValue({ data: undefined, isError: viewError, refetch: refetchView });
    mocks.query.mockReturnValue({ data: undefined, isError: formError, refetch: refetchForm });
    const tree = DraftEditorPage();
    expect(mocks.approval).toHaveBeenCalledWith("doc-1");
    expect(mocks.query).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["approval-form", "doc-1"] }),
    );
    expect(refetchView).not.toHaveBeenCalled();
    expect(refetchForm).not.toHaveBeenCalled();
    retry(tree);
    expect(refetchView).toHaveBeenCalledTimes(viewError ? 1 : 0);
    expect(refetchForm).toHaveBeenCalledTimes(formError ? 1 : 0);
    if (viewError) expect(refetchView).toHaveBeenCalledWith();
    if (formError) expect(refetchForm).toHaveBeenCalledWith();
  });

  it("새 양식은 detail 대기·오류로 편집 화면을 막지 않는다", () => {
    mocks.params.id = "new";
    const refetch = vi.fn();
    mocks.formDetail.mockReturnValue({ data: undefined, isError: true, refetch });
    const tree = FormBuilderPage();
    expect(mocks.formDetail).toHaveBeenCalledWith(undefined);
    expect(tree.type).toBe("form");
    expect(refetch).not.toHaveBeenCalled();
  });
});
