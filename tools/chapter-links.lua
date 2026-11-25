-- Source links work on GitHub; published chapter links point to the rendered pages.
local function chapter_link(link)
  if link.target:match("^%a[%w+%.%-]*:") or link.target:match("^//") then
    return link
  end
  local path, suffix = link.target:match("^([^?#]*)(.*)$")
  link.target = path:gsub("%.md$", ".html") .. suffix
  return link
end

local function scroll_block(class, content)
  return pandoc.Div({content}, pandoc.Attr("", {class}, {tabindex = "0"}))
end

local function whitespace(inline)
  return inline.t == "SoftBreak" or inline.t == "Space" or inline.t == "LineBreak"
end

-- Keep emphasis and links on their original text when an author puts an
-- entire sentence, including a display equation, inside an inline wrapper.
local wrappers = {Link = true, Span = true, Strong = true, Emph = true,
  Underline = true, Strikeout = true, SmallCaps = true, Subscript = true, Superscript = true}

local function equation_runs(inlines)
  local runs, prose = {}, {}
  local function append(inline, equation)
    if equation then
      if #prose > 0 then table.insert(runs, {content = prose}) end
      prose = {}
      table.insert(runs, {content = {inline}, equation = true})
    else
      table.insert(prose, inline)
    end
  end

  for _, inline in ipairs(inlines) do
    local nested = wrappers[inline.t] and equation_runs(inline.content)
    if nested then
      for index, run in ipairs(nested) do
        local part = inline:clone()
        part.content = run.content
        if index > 1 and (part.t == "Span" or part.t == "Link") then
          part.identifier = ""
        end
        append(part, run.equation)
      end
    else
      append(inline, inline.t == "Math" and inline.mathtype == "DisplayMath")
    end
  end
  if #runs > 0 then
    if #prose > 0 then table.insert(runs, {content = prose}) end
    return runs
  end
end

local function split_equations(block)
  local runs = equation_runs(block.content)
  if not runs then return end
  local output = {}
  for _, run in ipairs(runs) do
    if run.equation then
      table.insert(output, scroll_block("equation-block", pandoc.Plain(run.content)))
    else
      local first, last = 1, #run.content
      while first <= last and whitespace(run.content[first]) do first = first + 1 end
      while last >= first and whitespace(run.content[last]) do last = last - 1 end
      if first <= last then
        table.insert(output, pandoc[block.t]({table.unpack(run.content, first, last)}))
      end
    end
  end
  return output
end

local function standalone_image(block)
  if #block.content ~= 1 then return end
  local item = block.content[1]
  if item.t == "Image" then return item end
  if item.t == "Link" and #item.content == 1 and item.content[1].t == "Image" then
    return item.content[1], true
  end
end

local function make_figure(block)
  local image, linked = standalone_image(block)
  if not image then return end
  -- Keep an image link's accessible name. For other images, show its author's
  -- description as the caption and avoid reading the same words twice.
  local caption = {}
  if not linked then
    if #image.caption > 0 then caption = {pandoc.Plain(image.caption)} end
    image.caption = {}
    image.attributes.alt = ""
    block = pandoc.Plain({image})
  end
  local body = pandoc.Plain(block.content)
  if pandoc.Figure then return pandoc.Figure({body}, caption), false end
  -- Older Pandoc releases have no Figure node. Keep the image and its caption
  -- in the AST so the HTML writer still escapes and formats their content.
  local output = {pandoc.RawBlock("html", "<figure>"), body}
  if #caption > 0 then
    table.insert(output, pandoc.RawBlock("html", "<figcaption>"))
    table.insert(output, caption[1])
    table.insert(output, pandoc.RawBlock("html", "</figcaption>"))
  end
  table.insert(output, pandoc.RawBlock("html", "</figure>"))
  return output, false
end

local function keep_figure(figure)
  -- The implicit_figures reader can put the same text in both places already.
  if #figure.content == 1 and #figure.caption.long > 0 then
    local body = figure.content[1]
    if body.t == "Plain" or body.t == "Para" then
      local image, linked = standalone_image(body)
      if image and not linked and pandoc.utils.stringify(image.caption) == pandoc.utils.stringify(figure.caption.long) then
        image.caption = {}
        image.attributes.alt = ""
        figure.content = {pandoc.Plain({image})}
      end
    end
  end
  return figure, false
end

local is_overview = false

return {
  {Link = chapter_link, Para = split_equations, Plain = split_equations,
   Table = function(element) return scroll_block("table-scroll", element) end},
  {traverse = "topdown", Figure = keep_figure, Para = make_figure, Plain = make_figure},
  {Meta = function(meta) is_overview = meta['chapter-overview'] == true end},
  {Math = function(math)
    if is_overview and math.mathtype == 'InlineMath' then
      return pandoc.Span({math}, pandoc.Attr('', {'inline-formula'}))
    end
  end}
}
