import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { Compartment, EditorState, Prec, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, drawSelection, highlightActiveLine, keymap, placeholder, type DecorationSet } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { PostgreSQL, sql } from '@codemirror/lang-sql';
import { HighlightStyle, bracketMatching, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import type { TableInfo } from '../engine/protocol';

export interface EditorHandle {
  insert: (text: string) => void;
  focus: () => void;
}

export interface ErrorMark {
  pos: number;
  /** changes for every new error so the same position can be flagged twice */
  key: number;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  onRun: () => void;
  onSubmit?: () => void;
  errorMark?: ErrorMark | null;
  tables: TableInfo[];
  minHeight?: number;
  ref?: Ref<EditorHandle>;
}

const setError = StateEffect.define<{ from: number; to: number } | null>();
const errorField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    if (tr.docChanged) return Decoration.none;
    for (const e of tr.effects) {
      if (e.is(setError)) return e.value ? Decoration.set([Decoration.mark({ class: 'cm-sql-error' }).range(e.value.from, e.value.to)]) : Decoration.none;
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.modifier], color: '#1F2BC9', fontWeight: '700' },
  { tag: [t.string, t.special(t.string)], color: '#C2185B' },
  { tag: [t.number, t.bool, t.null], color: '#1B24A6', fontWeight: '700' },
  { tag: [t.lineComment, t.blockComment], color: '#5961CB', fontStyle: 'italic' },
  { tag: [t.typeName, t.standard(t.name)], color: '#141C8A' },
]);

const theme = EditorView.theme({
  '&': { fontSize: '14px', backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: "'JetBrains Mono Variable', ui-monospace, monospace",
    lineHeight: '24px',
    backgroundImage: 'repeating-linear-gradient(to bottom, transparent 0, transparent 23px, rgba(31,43,201,.10) 23px, rgba(31,43,201,.10) 24px)',
    backgroundAttachment: 'local',
    backgroundPosition: '0 8px',
  },
  '.cm-content': { padding: '8px 0', caretColor: '#1B24A6' },
  '.cm-line': { padding: '0 14px' },
  '.cm-activeLine': { backgroundColor: 'rgba(223,226,250,.6)' },
  '.cm-cursor': { borderLeftColor: '#1B24A6' },
  '.cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': { backgroundColor: '#D2D6F8' },
  '.cm-placeholder': { color: '#5961CB' },
  '.cm-tooltip': {
    border: '2px solid #1F2BC9',
    borderRadius: '0',
    backgroundColor: '#F6F7F9',
    boxShadow: '4px 4px 0 #FF5C8A',
    overflow: 'hidden',
  },
  '.cm-tooltip-autocomplete ul': { fontFamily: "'JetBrains Mono Variable', ui-monospace, monospace", fontSize: '13px' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: '#DFE2FA', color: '#1B24A6' },
  '.cm-matchingBracket': { backgroundColor: '#D2D6F8', outline: 'none' },
});

const schemaOf = (tables: TableInfo[]) => Object.fromEntries(tables.map((tb) => [tb.name, tb.columns.map((c) => c.name)]));
const dialect = (tables: TableInfo[]) => sql({ dialect: PostgreSQL, schema: schemaOf(tables), upperCaseKeywords: true });

export function SqlEditor({ value, onChange, onRun, onSubmit, errorMark, tables, minHeight = 200, ref }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const lang = useRef(new Compartment());
  const cb = useRef({ onChange, onRun, onSubmit });
  cb.current = { onChange, onRun, onSubmit };

  useImperativeHandle(ref, () => ({
    insert(text: string) {
      const v = view.current;
      if (!v) return;
      v.dispatch(v.state.replaceSelection(text));
      v.focus();
    },
    focus() {
      view.current?.focus();
    },
  }));

  useEffect(() => {
    if (!host.current) return;
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          Prec.highest(
            keymap.of([
              { key: 'Mod-Enter', run: () => (cb.current.onRun(), true) },
              { key: 'Mod-Shift-Enter', run: () => (cb.current.onSubmit ? (cb.current.onSubmit(), true) : false) },
            ]),
          ),
          history(),
          drawSelection(),
          highlightActiveLine(),
          bracketMatching(),
          closeBrackets(),
          autocompletion({ activateOnTyping: true, icons: false }),
          keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
          lang.current.of(dialect(tables)),
          syntaxHighlighting(highlight),
          theme,
          errorField,
          placeholder('Write SQL here. Ctrl/⌘ + Enter to run'),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) cb.current.onChange(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
    // the editor is created once; props flow in through the effects below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({ effects: lang.current.reconfigure(dialect(tables)) });
  }, [tables]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    if (!errorMark) {
      v.dispatch({ effects: setError.of(null) });
      return;
    }
    const doc = v.state.doc.toString();
    const from = Math.min(Math.max(errorMark.pos, 0), Math.max(doc.length - 1, 0));
    const word = /^[\w$"]+|^./.exec(doc.slice(from));
    const to = Math.min(doc.length, from + Math.max(1, word?.[0].length ?? 1));
    v.dispatch({ effects: setError.of({ from, to }) });
  }, [errorMark]);

  return <div ref={host} className="editor" style={{ minHeight }} />;
}
