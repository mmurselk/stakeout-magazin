import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import * as api from './api';
import { useToast } from './toast';

export const qk = {
  groups: (uid: string) => ['groups', uid] as const,
  members: (gid: string) => ['members', gid] as const,
  invites: (gid: string) => ['invites', gid] as const,
  categories: (gid: string) => ['categories', gid] as const,
  catalog: (gid: string) => ['catalog', gid] as const,
  item: (id: string) => ['item', id] as const,
  itemReviews: (id: string) => ['itemReviews', id] as const,
  itemPlans: (id: string) => ['itemPlans', id] as const,
  userReviews: (gid: string, uid: string) => ['userReviews', gid, uid] as const,
  feed: (gid: string) => ['feed', gid] as const,
  plans: (gid: string) => ['plans', gid] as const,
  lists: (gid: string) => ['lists', gid] as const,
  list: (id: string) => ['list', id] as const,
  listEntries: (id: string) => ['listEntries', id] as const,
  comments: (kind: string, id: string) => ['comments', kind, id] as const,
  photos: (paths: string[]) => ['photos', [...paths].sort().join('|')] as const,
};

export const useMyGroups = (uid: string | undefined) =>
  useQuery({ queryKey: qk.groups(uid ?? ''), queryFn: () => api.listMyGroups(uid!), enabled: !!uid });

export const useMembers = (gid: string) => useQuery({ queryKey: qk.members(gid), queryFn: () => api.listMembers(gid) });
export const useCategories = (gid: string) => useQuery({ queryKey: qk.categories(gid), queryFn: () => api.listCategories(gid), staleTime: 5 * 60_000 });

/** Signed URLs for private photos; batched per distinct set of paths and cached for 50 min. */
export function useSignedUrls(paths: (string | null | undefined)[]) {
  const clean = [...new Set(paths.filter((p): p is string => !!p))];
  return useQuery({
    queryKey: qk.photos(clean),
    queryFn: () => api.signedUrls(clean),
    enabled: clean.length > 0,
    staleTime: 50 * 60_000,
    gcTime: 60 * 60_000,
  }).data ?? {};
}

/** Mutation helper: toasts failures, invalidates the given keys on success. */
export function useAction<TArgs, TRes = void>(
  fn: (args: TArgs) => Promise<TRes>,
  opts: { invalidate?: (QueryKey | string)[]; success?: string; onSuccess?: (r: TRes, a: TArgs) => void } = {},
) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: (res, args) => {
      for (const k of opts.invalidate ?? []) qc.invalidateQueries({ queryKey: typeof k === 'string' ? [k] : k });
      if (opts.success) toast.show(opts.success);
      opts.onSuccess?.(res, args);
    },
    onError: (e: Error) => toast.show(e.message, 'error'),
  });
}
