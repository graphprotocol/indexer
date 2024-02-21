import type { QueryResolvers } from './../../../types.generated'

export const dispute: NonNullable<QueryResolvers['dispute']> = async (
  _parent,
  { identifier },
  { models },
) => {
  const dispute = await models.POIDispute.findOne({
    where: { ...identifier },
  })

  return dispute?.toGraphQL() || null
}
