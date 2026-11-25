-- Keep links between chapter sources usable on GitHub and in the published book.
function Link(link)
  if link.target:match("^%a[%w+%.%-]*:") or link.target:match("^//") then
    return link
  end
  local path, suffix = link.target:match("^([^?#]*)(.*)$")
  link.target = path:gsub("%.md$", ".html") .. suffix
  return link
end
