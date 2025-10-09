import Foundation
import CoreData

public final class CoreDataStack {
    public enum StackError: Error {
        case storeInitializationFailed(Error)
    }

    public let container: NSPersistentContainer

    public init(name: String = "ListItCache", inMemory: Bool = false) throws {
        let model = Self.makeModel()
        container = NSPersistentContainer(name: name, managedObjectModel: model)
        if inMemory {
            let description = NSPersistentStoreDescription()
            description.type = NSInMemoryStoreType
            container.persistentStoreDescriptions = [description]
        }

        var initializationError: Error?
        container.loadPersistentStores { _, error in
            if let error {
                initializationError = error
            }
        }

        if let initializationError {
            throw StackError.storeInitializationFailed(initializationError)
        }

        container.viewContext.mergePolicy = NSMergeByPropertyObjectTrumpMergePolicy
        container.viewContext.automaticallyMergesChangesFromParent = true
    }

    public func newBackgroundContext() -> NSManagedObjectContext {
        container.newBackgroundContext()
    }

    private static func makeModel() -> NSManagedObjectModel {
        let model = NSManagedObjectModel()

        let entity = NSEntityDescription()
        entity.name = "CachedListing"
        entity.managedObjectClassName = NSStringFromClass(CachedListing.self)

        let idAttribute = NSAttributeDescription()
        idAttribute.name = "id"
        idAttribute.attributeType = .stringAttributeType
        idAttribute.isOptional = false

        let titleAttribute = NSAttributeDescription()
        titleAttribute.name = "title"
        titleAttribute.attributeType = .stringAttributeType
        titleAttribute.isOptional = false

        let subtitleAttribute = NSAttributeDescription()
        subtitleAttribute.name = "subtitle"
        subtitleAttribute.attributeType = .stringAttributeType
        subtitleAttribute.isOptional = true

        let priceTextAttribute = NSAttributeDescription()
        priceTextAttribute.name = "priceText"
        priceTextAttribute.attributeType = .stringAttributeType
        priceTextAttribute.isOptional = true

        let priceValueAttribute = NSAttributeDescription()
        priceValueAttribute.name = "priceValue"
        priceValueAttribute.attributeType = .doubleAttributeType
        priceValueAttribute.isOptional = true

        let locationAttribute = NSAttributeDescription()
        locationAttribute.name = "locationLabel"
        locationAttribute.attributeType = .stringAttributeType
        locationAttribute.isOptional = true

        let descriptionAttribute = NSAttributeDescription()
        descriptionAttribute.name = "descriptionText"
        descriptionAttribute.attributeType = .stringAttributeType
        descriptionAttribute.isOptional = true

        let tagsAttribute = NSAttributeDescription()
        tagsAttribute.name = "tagsString"
        tagsAttribute.attributeType = .stringAttributeType
        tagsAttribute.isOptional = true

        let coverAttribute = NSAttributeDescription()
        coverAttribute.name = "coverURL"
        coverAttribute.attributeType = .stringAttributeType
        coverAttribute.isOptional = true

        let sellerNameAttribute = NSAttributeDescription()
        sellerNameAttribute.name = "sellerName"
        sellerNameAttribute.attributeType = .stringAttributeType
        sellerNameAttribute.isOptional = true

        let sellerAvatarAttribute = NSAttributeDescription()
        sellerAvatarAttribute.name = "sellerAvatar"
        sellerAvatarAttribute.attributeType = .stringAttributeType
        sellerAvatarAttribute.isOptional = true

        let createdAtAttribute = NSAttributeDescription()
        createdAtAttribute.name = "createdAt"
        createdAtAttribute.attributeType = .dateAttributeType
        createdAtAttribute.isOptional = true

        let isFavoriteAttribute = NSAttributeDescription()
        isFavoriteAttribute.name = "isFavorite"
        isFavoriteAttribute.attributeType = .booleanAttributeType
        isFavoriteAttribute.isOptional = false
        isFavoriteAttribute.defaultValue = false

        let isBoostedAttribute = NSAttributeDescription()
        isBoostedAttribute.name = "isBoosted"
        isBoostedAttribute.attributeType = .booleanAttributeType
        isBoostedAttribute.isOptional = false
        isBoostedAttribute.defaultValue = false

        let isSoldAttribute = NSAttributeDescription()
        isSoldAttribute.name = "isSold"
        isSoldAttribute.attributeType = .booleanAttributeType
        isSoldAttribute.isOptional = false
        isSoldAttribute.defaultValue = false

        let distanceTextAttribute = NSAttributeDescription()
        distanceTextAttribute.name = "distanceText"
        distanceTextAttribute.attributeType = .stringAttributeType
        distanceTextAttribute.isOptional = true

        let distanceValueAttribute = NSAttributeDescription()
        distanceValueAttribute.name = "distanceValue"
        distanceValueAttribute.attributeType = .doubleAttributeType
        distanceValueAttribute.isOptional = true

        let updatedAtAttribute = NSAttributeDescription()
        updatedAtAttribute.name = "updatedAt"
        updatedAtAttribute.attributeType = .dateAttributeType
        updatedAtAttribute.isOptional = false

        entity.properties = [
            idAttribute,
            titleAttribute,
            subtitleAttribute,
            priceTextAttribute,
            priceValueAttribute,
            locationAttribute,
            descriptionAttribute,
            tagsAttribute,
            coverAttribute,
            sellerNameAttribute,
            sellerAvatarAttribute,
            createdAtAttribute,
            isFavoriteAttribute,
            isBoostedAttribute,
            isSoldAttribute,
            distanceTextAttribute,
            distanceValueAttribute,
            updatedAtAttribute
        ]
        entity.uniquenessConstraints = [["id"]]

        model.entities = [entity]
        return model
    }
}

public protocol ListingsPersisting {
    func store(listings: [ListingSummary]) throws
    func loadListings() throws -> [ListingSummary]
    func clear() throws
}

public final class CoreDataListingsPersistence: ListingsPersisting {
    private let context: NSManagedObjectContext

    public init(stack: CoreDataStack? = nil) {
        self.context = CoreDataListingsPersistence.resolveContext(from: stack)
    }

    public func store(listings: [ListingSummary]) throws {
        var thrownError: Error?
        context.performAndWait {
            do {
                try self.clearInternal()
                let now = Date()
                for listing in listings {
                    let cached = CachedListing(context: context)
                    cached.id = listing.id
                    cached.title = listing.title
                    cached.subtitle = listing.subtitle
                    cached.priceText = listing.priceText
                    if let price = listing.price { cached.priceValue = NSNumber(value: price) }
                    cached.locationLabel = listing.location
                    cached.descriptionText = listing.description
                    cached.tagsString = listing.tags.joined(separator: ",")
                    cached.coverURL = listing.coverImageURL?.absoluteString
                    cached.sellerName = listing.sellerName
                    cached.sellerAvatar = listing.sellerAvatarURL?.absoluteString
                    cached.createdAt = listing.createdAt
                    cached.isFavorite = listing.isFavorite
                    cached.isBoosted = listing.isBoosted
                    cached.isSold = listing.isSold
                    cached.distanceText = listing.distanceText
                    if let distance = listing.distanceMeters { cached.distanceValue = NSNumber(value: distance) }
                    cached.updatedAt = now
                }
                if context.hasChanges {
                    try context.save()
                }
            } catch {
                thrownError = error
            }
        }
        if let thrownError { throw thrownError }
    }

    public func loadListings() throws -> [ListingSummary] {
        var results: [ListingSummary] = []
        var thrownError: Error?
        context.performAndWait {
            do {
                let request: NSFetchRequest<CachedListing> = CachedListing.fetchRequest()
                request.sortDescriptors = [NSSortDescriptor(key: #keyPath(CachedListing.updatedAt), ascending: false)]
                let fetched = try context.fetch(request)
                results = fetched.map { cached in
                    ListingSummary(
                        id: cached.id,
                        title: cached.title,
                        subtitle: cached.subtitle ?? "",
                        priceText: cached.priceText,
                        price: cached.priceValue?.doubleValue,
                        location: cached.locationLabel,
                        description: cached.descriptionText ?? "",
                        tags: cached.tagsString?.split(separator: ",").map { String($0) } ?? [],
                        coverImageURL: cached.coverURL.flatMap(URL.init(string:)),
                        galleryImages: [],
                        sellerName: cached.sellerName,
                        sellerAvatarURL: cached.sellerAvatar.flatMap(URL.init(string:)),
                        createdAt: cached.createdAt,
                        isFavorite: cached.isFavorite,
                        isBoosted: cached.isBoosted,
                        isSold: cached.isSold,
                        distanceText: cached.distanceText,
                        distanceMeters: cached.distanceValue?.doubleValue
                    )
                }
            } catch {
                thrownError = error
            }
        }
        if let thrownError { throw thrownError }
        return results
    }

    public func clear() throws {
        var thrownError: Error?
        context.performAndWait {
            do {
                try self.clearInternal()
                if context.hasChanges {
                    try context.save()
                }
            } catch {
                thrownError = error
            }
        }
        if let thrownError { throw thrownError }
    }

    private func clearInternal() throws {
        let fetchRequest: NSFetchRequest<NSFetchRequestResult> = CachedListing.fetchRequest()
        let deleteRequest = NSBatchDeleteRequest(fetchRequest: fetchRequest)
        deleteRequest.resultType = .resultTypeObjectIDs
        let result = try context.execute(deleteRequest) as? NSBatchDeleteResult
        if let objectIDs = result?.result as? [NSManagedObjectID], !objectIDs.isEmpty {
            let changes: [AnyHashable: Any] = [NSDeletedObjectsKey: objectIDs]
            NSManagedObjectContext.mergeChanges(fromRemoteContextSave: changes, into: [context])
        }
    }
}

private extension CoreDataListingsPersistence {
    static func resolveContext(from stack: CoreDataStack?) -> NSManagedObjectContext {
        if let stack {
            return stack.container.viewContext
        }
        if let stack = try? CoreDataStack() {
            return stack.container.viewContext
        }
        if let fallback = try? CoreDataStack(inMemory: true) {
            return fallback.container.viewContext
        }
        fatalError("Unable to create Core Data stack for listings persistence")
    }
}
