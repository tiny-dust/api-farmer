import pluralize from 'pluralize'
import { camelize, pascalCase } from 'rattail'

export function transformModuleName({ name }: { name: string }) {
  return camelize(name)
}

export function transformVerb({ method }: { method: string }) {
  switch (method) {
    case 'post':
      return 'Create'
    case 'put':
      return 'Update'
    default:
      return pascalCase(method)
  }
}

export function transformUrl({ path, base }: { path: string; base?: string }) {
  return (base ? path.replace(base, '') : path).replace(/{/g, ':').replace(/}/g, '')
}

export function transformEntity({ path, method, base }: { path: string; method: string; base?: string }) {
  path = base ? path.replace(base, '') : path

  const words = path.split('/').filter(Boolean)
  return words.reduce((entity, word, index) => {
    if (word.includes('{')) {
      return entity
    }

    word = pluralize.singular(pascalCase(word))

    if (method === 'get' && index === words.length - 1) {
      word = pluralize.plural(word)
    }

    return `${entity}${word}`
  }, '')
}

export function transformFn({ verb, entity }: { verb: string; entity: string }) {
  return `api${verb}${entity}`
}

export function transformType({ verb, entity }: { verb: string; entity: string }) {
  return `Api${verb}${entity}`
}

export function transformTypeValue({ path, method }: { path: string; method: string }) {
  return `paths['${path}']['${method}']`
}

export function transformTypeQuery({ verb, entity }: { verb: string; entity: string }) {
  return `Api${verb}${entity}Query`
}

export function transformTypeQueryValue({ type }: { type: string }) {
  return `${type}['parameters']['query']`
}

export function transformTypeRequestBody({ verb, entity }: { verb: string; entity: string }) {
  return `Api${verb}${entity}RequestBody`
}

export function transformTypeRequestBodyValue({ type, required }: { type: string; required: boolean }) {
  return required
    ? `${type}['requestBody']['content']['application/json']`
    : `NonNullable<${type}['requestBody']>['content']['application/json'] | undefined`
}

export function transformTypeResponseBody({ verb, entity }: { verb: string; entity: string }) {
  return `Api${verb}${entity}ResponseBody`
}

export function transformTypeResponseBodyValue({
  type,
  statusCode,
  mime,
}: {
  type: string
  statusCode: number
  mime: string
}) {
  return `${type}['responses']['${statusCode}']['content']['${mime}']`
}

export interface Transformer {
  moduleName: typeof transformModuleName
  verb: typeof transformVerb
  url: typeof transformUrl
  entity: typeof transformEntity
  fn: typeof transformFn
  type: typeof transformType
  typeValue: typeof transformTypeValue
  typeQuery: typeof transformTypeQuery
  typeQueryValue: typeof transformTypeQueryValue
  typeRequestBody: typeof transformTypeRequestBody
  typeRequestBodyValue: typeof transformTypeRequestBodyValue
  typeResponseBody: typeof transformTypeResponseBody
  typeResponseBodyValue: typeof transformTypeResponseBodyValue
}

export function createTransformer(): Transformer {
  return {
    moduleName: transformModuleName,
    verb: transformVerb,
    url: transformUrl,
    entity: transformEntity,
    fn: transformFn,
    type: transformType,
    typeValue: transformTypeValue,
    typeQuery: transformTypeQuery,
    typeQueryValue: transformTypeQueryValue,
    typeRequestBody: transformTypeRequestBody,
    typeRequestBodyValue: transformTypeRequestBodyValue,
    typeResponseBody: transformTypeResponseBody,
    typeResponseBodyValue: transformTypeResponseBodyValue,
  }
}
