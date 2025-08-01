/// <reference types="mdast-util-directive" />

import type { AstroConfig, AstroIntegration, AstroUserConfig } from 'astro';
import { h as _h, s as _s, type Properties, type Result } from 'hastscript';
import type { Node, Paragraph as P, Parent, PhrasingContent, Root } from 'mdast';
import {
	type Directives,
	directiveToMarkdown,
	type TextDirective,
	type LeafDirective,
} from 'mdast-util-directive';
import { toMarkdown } from 'mdast-util-to-markdown';
import { toString } from 'mdast-util-to-string';
import remarkDirective from 'remark-directive';
import type { Plugin, Transformer } from 'unified';
import { visit } from 'unist-util-visit';
import type { HookParameters, StarlightConfig, StarlightIcon } from '../types';
import { getRemarkRehypeDocsCollectionPath, shouldTransformFile } from './remark-rehype-utils';
import { Icons } from '../components/Icons';
import { fromHtml } from 'hast-util-from-html';
import type { Element } from 'hast';
import { throwInvalidAsideIconError } from './asides-error';

interface AsidesOptions {
	starlightConfig: Pick<StarlightConfig, 'defaultLocale' | 'locales'>;
	astroConfig: { root: AstroConfig['root']; srcDir: AstroConfig['srcDir'] };
	useTranslations: HookParameters<'config:setup'>['useTranslations'];
	absolutePathToLang: HookParameters<'config:setup'>['absolutePathToLang'];
}

/** Hacky function that generates an mdast HTML tree ready for conversion to HTML by rehype. */
function h(el: string, attrs: Properties = {}, children: any[] = []): P {
	const { tagName, properties } = _h(el, attrs);
	return {
		type: 'paragraph',
		data: { hName: tagName, hProperties: properties },
		children,
	};
}

/** Hacky function that generates an mdast SVG tree ready for conversion to HTML by rehype. */
function s(el: string, attrs: Properties = {}, children: any[] = []): P {
	const { tagName, properties } = _s(el, attrs);
	return {
		type: 'paragraph',
		data: { hName: tagName, hProperties: properties },
		children,
	};
}

/** Checks if a node is a directive. */
function isNodeDirective(node: Node): node is Directives {
	return (
		node.type === 'textDirective' ||
		node.type === 'leafDirective' ||
		node.type === 'containerDirective'
	);
}

/**
 * Transforms back directives not handled by Starlight to avoid breaking user content.
 * For example, a user might write `x:y` in the middle of a sentence, where `:y` would be
 * identified as a text directive, which are not used by Starlight, and we definitely want that
 * text to be rendered verbatim in the output.
 */
function transformUnhandledDirective(
	node: TextDirective | LeafDirective,
	index: number,
	parent: Parent
) {
	let markdown = toMarkdown(node, { extensions: [directiveToMarkdown()] });
	/**
	 * `mdast-util-to-markdown` assumes that the tree represents a complete document (as it's an AST
	 * and not a CST) and to follow the POSIX definition of a line (a sequence of zero or more
	 * non- <newline> characters plus a terminating <newline> character), a newline is automatically
	 * added at the end of the output so that the output is a valid file.
	 * In this specific case, we can safely remove the newline character at the end of the output
	 * before replacing the directive with its value.
	 *
	 * @see https://pubs.opengroup.org/onlinepubs/9699919799/basedefs/V1_chap03.html#tag_03_206
	 * @see https://github.com/syntax-tree/mdast-util-to-markdown/blob/fd6a508cc619b862f75b762dcf876c6b8315d330/lib/index.js#L79-L85
	 */
	if (markdown.at(-1) === '\n') markdown = markdown.slice(0, -1);
	const textNode = { type: 'text', value: markdown } as const;
	if (node.type === 'textDirective') {
		parent.children[index] = textNode;
	} else {
		parent.children[index] = {
			type: 'paragraph',
			children: [textNode],
		};
	}
}

/** Hacky function that generates the children of an mdast SVG tree. */
function makeSvgChildNodes(children: Result['children']): any[] {
	const nodes: P[] = [];
	for (const child of children) {
		if (child.type !== 'element') continue;
		nodes.push({
			type: 'paragraph',
			data: { hName: child.tagName, hProperties: child.properties },
			children: makeSvgChildNodes(child.children),
		});
	}
	return nodes;
}

/**
 * remark plugin that converts blocks delimited with `:::` into styled
 * asides (a.k.a. “callouts”, “admonitions”, etc.). Depends on the
 * `remark-directive` module for the core parsing logic.
 *
 * For example, this Markdown
 *
 * ```md
 * :::tip[Did you know?]
 * Astro helps you build faster websites with “Islands Architecture”.
 * :::
 * ```
 *
 * will produce this output
 *
 * ```astro
 * <aside class="starlight-aside starlight-aside--tip" aria-label="Did you know?">
 *   <p class="starlight-aside__title" aria-hidden="true">Did you know?</p>
 *   <div class="starlight-aside__content">
 *     <p>Astro helps you build faster websites with “Islands Architecture”.</p>
 *   </div>
 * </aside>
 * ```
 */
function remarkAsides(options: AsidesOptions): Plugin<[], Root> {
	type Variant = 'note' | 'tip' | 'caution' | 'danger';
	const variants = new Set(['note', 'tip', 'caution', 'danger']);
	const isAsideVariant = (s: string): s is Variant => variants.has(s);

	const iconPaths = {
		// Information icon
		note: [
			s('path', {
				d: 'M12 11C11.7348 11 11.4804 11.1054 11.2929 11.2929C11.1054 11.4804 11 11.7348 11 12V16C11 16.2652 11.1054 16.5196 11.2929 16.7071C11.4804 16.8946 11.7348 17 12 17C12.2652 17 12.5196 16.8946 12.7071 16.7071C12.8946 16.5196 13 16.2652 13 16V12C13 11.7348 12.8946 11.4804 12.7071 11.2929C12.5196 11.1054 12.2652 11 12 11ZM12.38 7.08C12.1365 6.97998 11.8635 6.97998 11.62 7.08C11.4973 7.12759 11.3851 7.19896 11.29 7.29C11.2017 7.3872 11.1306 7.49882 11.08 7.62C11.024 7.73868 10.9966 7.86882 11 8C10.9992 8.13161 11.0245 8.26207 11.0742 8.38391C11.124 8.50574 11.1973 8.61656 11.29 8.71C11.3872 8.79833 11.4988 8.86936 11.62 8.92C11.7715 8.98224 11.936 9.00632 12.099 8.99011C12.2619 8.97391 12.4184 8.91792 12.5547 8.82707C12.691 8.73622 12.8029 8.61328 12.8805 8.46907C12.9582 8.32486 12.9992 8.16378 13 8C12.9963 7.73523 12.8927 7.48163 12.71 7.29C12.6149 7.19896 12.5028 7.12759 12.38 7.08ZM12 2C10.0222 2 8.08879 2.58649 6.4443 3.6853C4.79981 4.78412 3.51809 6.3459 2.76121 8.17317C2.00433 10.0004 1.8063 12.0111 2.19215 13.9509C2.578 15.8907 3.53041 17.6725 4.92894 19.0711C6.32746 20.4696 8.10929 21.422 10.0491 21.8079C11.9889 22.1937 13.9996 21.9957 15.8268 21.2388C17.6541 20.4819 19.2159 19.2002 20.3147 17.5557C21.4135 15.9112 22 13.9778 22 12C22 10.6868 21.7413 9.38642 21.2388 8.17317C20.7363 6.95991 19.9997 5.85752 19.0711 4.92893C18.1425 4.00035 17.0401 3.26375 15.8268 2.7612C14.6136 2.25866 13.3132 2 12 2ZM12 20C10.4178 20 8.87104 19.5308 7.55544 18.6518C6.23985 17.7727 5.21447 16.5233 4.60897 15.0615C4.00347 13.5997 3.84504 11.9911 4.15372 10.4393C4.4624 8.88743 5.22433 7.46197 6.34315 6.34315C7.46197 5.22433 8.88743 4.4624 10.4393 4.15372C11.9911 3.84504 13.5997 4.00346 15.0615 4.60896C16.5233 5.21447 17.7727 6.23984 18.6518 7.55544C19.5308 8.87103 20 10.4177 20 12C20 14.1217 19.1572 16.1566 17.6569 17.6569C16.1566 19.1571 14.1217 20 12 20Z',
			}),
		],
		// Rocket icon
		tip: [
			s('path', {
				'fill-rule': 'evenodd',
				'clip-rule': 'evenodd',
				d: 'M1.43909 8.85483L1.44039 8.85354L4.96668 5.33815C5.30653 4.99386 5.7685 4.79662 6.2524 4.78972L6.26553 4.78963L12.9014 4.78962L13.8479 3.84308C16.9187 0.772319 20.0546 0.770617 21.4678 0.975145C21.8617 1.02914 22.2271 1.21053 22.5083 1.4917C22.7894 1.77284 22.9708 2.13821 23.0248 2.53199C23.2294 3.94517 23.2278 7.08119 20.1569 10.1521L19.2107 11.0983V17.7338L19.2106 17.7469C19.2037 18.2308 19.0067 18.6933 18.6624 19.0331L15.1456 22.5608C14.9095 22.7966 14.6137 22.964 14.29 23.0449C13.9663 23.1259 13.6267 23.1174 13.3074 23.0204C12.9881 22.9235 12.7011 22.7417 12.4771 22.4944C12.2533 22.2473 12.1006 21.9441 12.0355 21.6171L11.1783 17.3417L6.65869 12.822L4.34847 12.3589L2.38351 11.965C2.05664 11.8998 1.75272 11.747 1.50564 11.5232C1.25835 11.2992 1.07653 11.0122 0.979561 10.6929C0.882595 10.3736 0.874125 10.034 0.955057 9.7103C1.03599 9.38659 1.20328 9.09092 1.43909 8.85483ZM6.8186 10.8724L2.94619 10.096L6.32006 6.73268H10.9583L6.8186 10.8724ZM15.2219 5.21703C17.681 2.75787 20.0783 2.75376 21.1124 2.8876C21.2462 3.92172 21.2421 6.31895 18.783 8.77812L12.0728 15.4883L8.51172 11.9272L15.2219 5.21703ZM13.9042 21.0538L13.1279 17.1811L17.2676 13.0414V17.68L13.9042 21.0538Z',
			}),
			s('path', {
				d: 'M9.31827 18.3446C9.45046 17.8529 9.17864 17.3369 8.68945 17.1724C8.56178 17.1294 8.43145 17.1145 8.30512 17.1243C8.10513 17.1398 7.91519 17.2172 7.76181 17.3434C7.62613 17.455 7.51905 17.6048 7.45893 17.7835C6.97634 19.2186 5.77062 19.9878 4.52406 20.4029C4.08525 20.549 3.6605 20.644 3.29471 20.7053C3.35607 20.3395 3.45098 19.9148 3.59711 19.476C4.01221 18.2294 4.78141 17.0237 6.21648 16.5411C6.39528 16.481 6.54504 16.3739 6.65665 16.2382C6.85126 16.0016 6.92988 15.678 6.84417 15.3647C6.83922 15.3466 6.83373 15.3286 6.82767 15.3106C6.74106 15.053 6.55701 14.8557 6.33037 14.7459C6.10949 14.6389 5.84816 14.615 5.59715 14.6994C5.47743 14.7397 5.36103 14.7831 5.24786 14.8294C3.22626 15.6569 2.2347 17.4173 1.75357 18.8621C1.49662 19.6337 1.36993 20.3554 1.30679 20.8818C1.27505 21.1464 1.25893 21.3654 1.25072 21.5213C1.24662 21.5993 1.24448 21.6618 1.24337 21.7066L1.243 21.7226L1.24235 21.7605L1.2422 21.7771L1.24217 21.7827L1.24217 21.7856C1.24217 22.3221 1.67703 22.7579 2.2137 22.7579L2.2155 22.7579L2.22337 22.7578L2.23956 22.7577C2.25293 22.7575 2.27096 22.7572 2.29338 22.7567C2.33821 22.7555 2.40073 22.7534 2.47876 22.7493C2.63466 22.7411 2.85361 22.725 3.11822 22.6932C3.64462 22.6301 4.36636 22.5034 5.13797 22.2464C6.58274 21.7653 8.3431 20.7738 9.17063 18.7522C9.21696 18.639 9.26037 18.5226 9.30064 18.4029C9.30716 18.3835 9.31304 18.364 9.31827 18.3446Z',
			}),
		],
		// Warning triangle icon
		caution: [
			s('path', {
				d: 'M12 16C11.8022 16 11.6089 16.0587 11.4444 16.1686C11.28 16.2784 11.1518 16.4346 11.0761 16.6173C11.0004 16.8001 10.9806 17.0011 11.0192 17.1951C11.0578 17.3891 11.153 17.5673 11.2929 17.7071C11.4327 17.847 11.6109 17.9422 11.8049 17.9808C11.9989 18.0194 12.2 17.9996 12.3827 17.9239C12.5654 17.8482 12.7216 17.72 12.8315 17.5556C12.9413 17.3911 13 17.1978 13 17C13 16.7348 12.8946 16.4805 12.7071 16.2929C12.5196 16.1054 12.2652 16 12 16ZM22.67 17.47L14.62 3.47003C14.3598 3.00354 13.9798 2.61498 13.5192 2.3445C13.0586 2.07401 12.5341 1.9314 12 1.9314C11.4659 1.9314 10.9414 2.07401 10.4808 2.3445C10.0202 2.61498 9.64019 3.00354 9.38 3.47003L1.38 17.47C1.11079 17.924 0.966141 18.441 0.960643 18.9688C0.955144 19.4966 1.089 20.0166 1.34868 20.4761C1.60837 20.9356 1.9847 21.3185 2.43968 21.5861C2.89466 21.8536 3.41218 21.9964 3.94 22H20.06C20.5921 22.0053 21.1159 21.8689 21.5779 21.6049C22.0399 21.341 22.4234 20.9589 22.689 20.4978C22.9546 20.0368 23.0928 19.5134 23.0895 18.9814C23.0862 18.4493 22.9414 17.9277 22.67 17.47ZM20.94 19.47C20.8523 19.626 20.7245 19.7556 20.5697 19.8453C20.4149 19.935 20.2389 19.9815 20.06 19.98H3.94C3.76111 19.9815 3.5851 19.935 3.43032 19.8453C3.27553 19.7556 3.14765 19.626 3.06 19.47C2.97223 19.318 2.92602 19.1456 2.92602 18.97C2.92602 18.7945 2.97223 18.622 3.06 18.47L11.06 4.47003C11.1439 4.30623 11.2714 4.16876 11.4284 4.07277C11.5855 3.97678 11.766 3.92599 11.95 3.92599C12.134 3.92599 12.3145 3.97678 12.4716 4.07277C12.6286 4.16876 12.7561 4.30623 12.84 4.47003L20.89 18.47C20.9892 18.6199 21.0462 18.7937 21.055 18.9732C21.0638 19.1527 21.0241 19.3312 20.94 19.49V19.47ZM12 8.00003C11.7348 8.00003 11.4804 8.10538 11.2929 8.29292C11.1054 8.48046 11 8.73481 11 9.00003V13C11 13.2652 11.1054 13.5196 11.2929 13.7071C11.4804 13.8947 11.7348 14 12 14C12.2652 14 12.5196 13.8947 12.7071 13.7071C12.8946 13.5196 13 13.2652 13 13V9.00003C13 8.73481 12.8946 8.48046 12.7071 8.29292C12.5196 8.10538 12.2652 8.00003 12 8.00003Z',
			}),
		],
		// Error shield icon
		danger: [
			s('path', {
				d: 'M12 7C11.7348 7 11.4804 7.10536 11.2929 7.29289C11.1054 7.48043 11 7.73478 11 8V12C11 12.2652 11.1054 12.5196 11.2929 12.7071C11.4804 12.8946 11.7348 13 12 13C12.2652 13 12.5196 12.8946 12.7071 12.7071C12.8946 12.5196 13 12.2652 13 12V8C13 7.73478 12.8946 7.48043 12.7071 7.29289C12.5196 7.10536 12.2652 7 12 7ZM12 15C11.8022 15 11.6089 15.0586 11.4444 15.1685C11.28 15.2784 11.1518 15.4346 11.0761 15.6173C11.0004 15.8 10.9806 16.0011 11.0192 16.1951C11.0578 16.3891 11.153 16.5673 11.2929 16.7071C11.4327 16.847 11.6109 16.9422 11.8049 16.9808C11.9989 17.0194 12.2 16.9996 12.3827 16.9239C12.5654 16.8482 12.7216 16.72 12.8315 16.5556C12.9414 16.3911 13 16.1978 13 16C13 15.7348 12.8946 15.4804 12.7071 15.2929C12.5196 15.1054 12.2652 15 12 15ZM21.71 7.56L16.44 2.29C16.2484 2.10727 15.9948 2.00368 15.73 2H8.27C8.00523 2.00368 7.75163 2.10727 7.56 2.29L2.29 7.56C2.10727 7.75163 2.00368 8.00523 2 8.27V15.73C2.00368 15.9948 2.10727 16.2484 2.29 16.44L7.56 21.71C7.75163 21.8927 8.00523 21.9963 8.27 22H15.73C15.9948 21.9963 16.2484 21.8927 16.44 21.71L21.71 16.44C21.8927 16.2484 21.9963 15.9948 22 15.73V8.27C21.9963 8.00523 21.8927 7.75163 21.71 7.56ZM20 15.31L15.31 20H8.69L4 15.31V8.69L8.69 4H15.31L20 8.69V15.31Z',
			}),
		],
	};

	const docsCollectionPath = getRemarkRehypeDocsCollectionPath(options.astroConfig.srcDir);

	const transformer: Transformer<Root> = (tree, file) => {
		if (!shouldTransformFile(file, docsCollectionPath)) return;

		const lang = options.absolutePathToLang(file.path);
		const t = options.useTranslations(lang);
		visit(tree, (node, index, parent) => {
			if (!parent || index === undefined || !isNodeDirective(node)) {
				return;
			}
			if (node.type === 'textDirective' || node.type === 'leafDirective') {
				return;
			}
			const variant = node.name;
			const attributes = node.attributes;
			if (!isAsideVariant(variant)) return;

			// remark-directive converts a container’s “label” to a paragraph added as the head of its
			// children with the `directiveLabel` property set to true. We want to pass it as the title
			// prop to <Aside>, so when we find a directive label, we store it for the title prop and
			// remove the paragraph from the container’s children.
			let title: string = t(`aside.${variant}`);
			let titleNode: PhrasingContent[] = [{ type: 'text', value: title }];
			const firstChild = node.children[0];
			if (
				firstChild?.type === 'paragraph' &&
				firstChild.data &&
				'directiveLabel' in firstChild.data &&
				firstChild.children.length > 0
			) {
				titleNode = firstChild.children;
				title = toString(firstChild.children);
				// The first paragraph contains a directive label, we can safely remove it.
				node.children.splice(0, 1);
			}

			let iconPath = iconPaths[variant];

			if (attributes?.['icon']) {
				const iconName = attributes['icon'] as StarlightIcon;
				const icon = Icons[iconName];
				if (!icon) throwInvalidAsideIconError(iconName);
				// Omit the root node and return only the first child which is the SVG element.
				const iconHastTree = fromHtml(`<svg>${icon}</svg>`, { fragment: true, space: 'svg' })
					.children[0] as Element;
				// Render all SVG child nodes.
				iconPath = makeSvgChildNodes(iconHastTree.children);
			}

			const aside = h(
				'aside',
				{
					'aria-label': title,
					class: `starlight-aside starlight-aside--${variant}`,
				},
				[
					h('p', { class: 'starlight-aside__title', 'aria-hidden': 'true' }, [
						s(
							'svg',
							{
								viewBox: '0 0 24 24',
								width: 16,
								height: 16,
								fill: 'currentColor',
								class: 'starlight-aside__icon',
							},
							iconPath
						),
						...titleNode,
					]),
					h('div', { class: 'starlight-aside__content' }, node.children),
				]
			);

			parent.children[index] = aside;
		});
	};

	return function attacher() {
		return transformer;
	};
}

type RemarkPlugins = NonNullable<NonNullable<AstroUserConfig['markdown']>['remarkPlugins']>;

export function starlightAsides(options: AsidesOptions): RemarkPlugins {
	return [remarkDirective, remarkAsides(options)];
}

export function remarkDirectivesRestoration() {
	return function transformer(tree: Root) {
		visit(tree, (node, index, parent) => {
			if (
				index !== undefined &&
				parent &&
				(node.type === 'textDirective' || node.type === 'leafDirective') &&
				node.data === undefined
			) {
				transformUnhandledDirective(node, index, parent);
				return;
			}
		});
	};
}

/**
 * Directives not handled by Starlight are transformed back to their original form to avoid
 * breaking user content.
 * To allow remark plugins injected by Starlight plugins through Astro integrations to handle
 * such directives, we need to restore unhandled text and leaf directives back to their original
 * form only after all these other plugins have run.
 * To do so, we run a remark plugin restoring these directives back to their original form from
 * another Astro integration that runs after all the ones that may have been injected by Starlight
 * plugins.
 */
export function starlightDirectivesRestorationIntegration(): AstroIntegration {
	return {
		name: 'starlight-directives-restoration',
		hooks: {
			'astro:config:setup': ({ updateConfig }) => {
				updateConfig({
					markdown: {
						remarkPlugins: [remarkDirectivesRestoration],
					},
				});
			},
		},
	};
}
