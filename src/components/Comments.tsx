import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as api from '../lib/api';
import { qk, useAction } from '../lib/hooks';
import { useGroup } from '../lib/group';
import { timeAgo } from '../lib/format';
import { Avatar, Icon, Loading } from './ui';

type Target = { review_id: string } | { plan_id: string } | { item_id: string };

export function Comments({ target, placeholder = 'Add a comment' }: { target: Target; placeholder?: string }) {
  const { group, me, isOwner, people } = useGroup();
  const [kind, id] = Object.entries(target)[0] as [string, string];
  const [text, setText] = useState('');
  const q = useQuery({ queryKey: qk.comments(kind, id), queryFn: () => api.listComments(target) });
  const counts = { review_id: 'feed', plan_id: 'plans', item_id: 'item' } as const;
  const add = useAction(
    (body: string) => api.addComment(group.id, me, target, body),
    { invalidate: [qk.comments(kind, id), [counts[kind as keyof typeof counts]]], onSuccess: () => setText('') },
  );
  const del = useAction((cid: string) => api.deleteComment(cid), { invalidate: [qk.comments(kind, id)] });

  return (
    <section className="comments" aria-label="Comments">
      {q.isLoading && <Loading />}
      {q.data?.map((c) => (
        <div className="comment" key={c.id}>
          <Avatar profile={c.author ?? people[c.author_id] ?? null} size={26} />
          <div>
            <p className="comment-head"><strong>{c.author?.display_name ?? 'Former member'}</strong> <span className="muted">{timeAgo(c.created_at)}</span></p>
            <p className="comment-body">{c.body}</p>
          </div>
          {(c.author_id === me || isOwner) && (
            <button type="button" className="icon-btn subtle" aria-label="Delete comment" onClick={() => del.mutate(c.id)}><Icon name="trash" size={16} /></button>
          )}
        </div>
      ))}
      <div className="comment-form">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} maxLength={1000} aria-label={placeholder}
          onKeyDown={(e) => { if (e.key === 'Enter' && text.trim() && !add.isPending) add.mutate(text); }} />
        <button type="button" className="btn small" disabled={!text.trim() || add.isPending} onClick={() => add.mutate(text)}>Post</button>
      </div>
    </section>
  );
}
